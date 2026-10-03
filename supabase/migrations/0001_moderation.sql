-- =============================================================================
-- 开门 OpenDoor · 邀请码共享池 —— 审核与反滥用核心 schema
-- 目标数据库：Supabase (PostgreSQL 15+)
-- 使用方式：Supabase Dashboard → SQL Editor 粘贴执行，或 supabase db push
--
-- 设计要点
--   1. 状态机集中在 invite_codes.status，流转由 RLS + 服务端函数强制；
--   2. 匿名/普通用户永远拿不到 pending 内容，也永远不能把 status 改成 approved；
--   3. 领取走 SECURITY DEFINER 的 claim_code()，行锁 + 原子自增防并发超领；
--   4. 状态变更由触发器写审计日志，应用层无法绕过。
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 枚举类型
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.invite_status as enum
    ('pending', 'approved', 'rejected', 'needs_changes', 'exhausted', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_role as enum ('user', 'moderator', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.code_type as enum ('link', 'single_code', 'multi_code');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 表：profiles（用户画像 / 角色）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text,
  role             public.user_role not null default 'user',
  reputation_score int not null default 100,
  is_banned        boolean not null default false,
  created_at       timestamptz not null default now()
);

-- 新用户注册时自动建 profile（角色默认 user，禁止前端自行提权）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', '社区用户'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 表：products（产品字典 + 域名白名单）
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  category         text not null,
  icon             text default '✦',
  description      text,
  domain_whitelist text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 表：invite_codes（邀请码主表 / 审核队列主体）
-- ---------------------------------------------------------------------------
create table if not exists public.invite_codes (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid references public.products (id) on delete set null,
  user_id        uuid references auth.users (id) on delete set null,
  product_name   text not null,
  category       text not null,
  icon           text default '✦',
  offer          text,
  tag            text default '待审核',
  code_type      public.code_type not null default 'multi_code',
  code_hash      text,                       -- sha256(归一化后的内容)，用于去重
  display_code   text not null,              -- 脱敏展示码
  secret_code    text not null,              -- 明文；生产环境建议加密/入 Vault
  status         public.invite_status not null default 'pending',
  max_claims     int not null default 1,
  current_claims int not null default 0,
  review_note    text,
  submitted_by   text default '匿名',
  submitted_at   timestamptz not null default now(),
  verified_at    timestamptz,
  expires_at     timestamptz,
  constraint chk_claims_range
    check (current_claims >= 0 and current_claims <= max_claims)
);

-- 去重：同一产品下，处于待审/已通过的相同内容只允许一条
create unique index if not exists uniq_active_code
  on public.invite_codes (product_id, code_hash)
  where status in ('pending', 'approved') and code_hash is not null;

-- 首页信息流 / 审核队列 查询索引
create index if not exists idx_invite_feed
  on public.invite_codes (status, category, submitted_at desc);
create index if not exists idx_invite_owner
  on public.invite_codes (user_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- 表：code_claims（领取流水，用于限流与审计）
-- ---------------------------------------------------------------------------
create table if not exists public.code_claims (
  id           bigserial primary key,
  code_id      uuid not null references public.invite_codes (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  visitor_hash text,
  claimed_at   timestamptz not null default now()
);
create index if not exists idx_claims_rate
  on public.code_claims (visitor_hash, claimed_at desc);

-- ---------------------------------------------------------------------------
-- 表：code_reports（失效 / 钓鱼 / 垃圾举报）
-- ---------------------------------------------------------------------------
create table if not exists public.code_reports (
  id          bigserial primary key,
  code_id     uuid not null references public.invite_codes (id) on delete cascade,
  reporter_id uuid references auth.users (id) on delete set null,
  reason      text not null check (reason in ('invalid', 'phishing', 'spam', 'other')),
  detail      text,
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);
create index if not exists idx_reports_code
  on public.code_reports (code_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 表：moderation_logs（审计日志，仅触发器/服务端写入）
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_logs (
  id            bigserial primary key,
  code_id       uuid not null references public.invite_codes (id) on delete cascade,
  operator_id   uuid references auth.users (id) on delete set null,
  action        text not null,
  from_status   public.invite_status,
  to_status     public.invite_status not null,
  reason        text,
  client_ip_hash text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_logs_code
  on public.moderation_logs (code_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 辅助函数：判断当前用户是否为审核员 / 管理员
-- ---------------------------------------------------------------------------
create or replace function public.is_moderator()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('moderator', 'admin')
      and is_banned = false
  );
$$;

-- ---------------------------------------------------------------------------
-- 审计：状态变更自动写日志（应用层无法绕过）
-- ---------------------------------------------------------------------------
create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.moderation_logs
      (code_id, operator_id, action, from_status, to_status, reason)
    values
      (new.id, auth.uid(), 'status_transition', old.status, new.status, new.review_note);
  end if;
  return new;
end $$;

drop trigger if exists trg_invite_status on public.invite_codes;
create trigger trg_invite_status
  after update of status on public.invite_codes
  for each row execute function public.log_status_change();

-- ---------------------------------------------------------------------------
-- 原子领取：行锁 + 自增 + 限流，返回明文或拒绝原因
-- ---------------------------------------------------------------------------
create or replace function public.claim_code(p_code_id uuid, p_visitor_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   public.invite_codes%rowtype;
  v_recent int;
  v_limit  int := 10;   -- 单访客每小时领取上限
begin
  select count(*) into v_recent
    from public.code_claims
   where visitor_hash = p_visitor_hash
     and claimed_at > now() - interval '1 hour';

  if v_recent >= v_limit then
    return jsonb_build_object('ok', false, 'message', '操作过于频繁，请稍后再试');
  end if;

  -- 行锁，避免并发超领
  select * into v_code
    from public.invite_codes
   where id = p_code_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '邀请码不存在');
  end if;

  if v_code.status <> 'approved' then
    return jsonb_build_object('ok', false, 'message', '该邀请码尚未通过审核或已下架');
  end if;

  if v_code.current_claims >= v_code.max_claims then
    update public.invite_codes set status = 'exhausted' where id = p_code_id;
    return jsonb_build_object('ok', false, 'message', '该邀请码已被领完');
  end if;

  update public.invite_codes
     set current_claims = current_claims + 1,
         status = case
                    when current_claims + 1 >= max_claims then 'exhausted'::public.invite_status
                    else status
                  end
   where id = p_code_id
   returning * into v_code;

  insert into public.code_claims (code_id, user_id, visitor_hash)
  values (p_code_id, auth.uid(), p_visitor_hash);

  return jsonb_build_object(
    'ok', true,
    'message', '领取成功，请尽快使用',
    'secret_code', v_code.secret_code,
    'remaining', greatest(v_code.max_claims - v_code.current_claims, 0)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 启用 RLS
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.products        enable row level security;
alter table public.invite_codes    enable row level security;
alter table public.code_claims     enable row level security;
alter table public.code_reports    enable row level security;
alter table public.moderation_logs enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_select_mod on public.profiles;
create policy profiles_select_mod on public.profiles
  for select to authenticated using (public.is_moderator());

-- products ------------------------------------------------------------------
drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon, authenticated using (is_active);

drop policy if exists products_write_mod on public.products;
create policy products_write_mod on public.products
  for all to authenticated using (public.is_moderator()) with check (public.is_moderator());

-- invite_codes --------------------------------------------------------------
-- 匿名/登录用户：只能看到 approved
drop policy if exists invite_select_approved on public.invite_codes;
create policy invite_select_approved on public.invite_codes
  for select to anon, authenticated using (status = 'approved');

-- 作者：能看到自己的全部提交
drop policy if exists invite_select_owner on public.invite_codes;
create policy invite_select_owner on public.invite_codes
  for select to authenticated using (auth.uid() = user_id);

-- 审核员：可见全部
drop policy if exists invite_select_mod on public.invite_codes;
create policy invite_select_mod on public.invite_codes
  for select to authenticated using (public.is_moderator());

-- 登录用户提交：只能以 pending 入库，且 user_id 必须是自己
drop policy if exists invite_insert_owner on public.invite_codes;
create policy invite_insert_owner on public.invite_codes
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending');

-- 作者修改：仅在 needs_changes 时可改，改完必须回到 pending
drop policy if exists invite_update_owner on public.invite_codes;
create policy invite_update_owner on public.invite_codes
  for update to authenticated
  using (auth.uid() = user_id and status = 'needs_changes')
  with check (auth.uid() = user_id and status = 'pending');

-- 审核员：可改状态
drop policy if exists invite_update_mod on public.invite_codes;
create policy invite_update_mod on public.invite_codes
  for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- 审核员：可删除
drop policy if exists invite_delete_mod on public.invite_codes;
create policy invite_delete_mod on public.invite_codes
  for delete to authenticated using (public.is_moderator());

-- code_claims ---------------------------------------------------------------
-- 不开放直接插入；由 claim_code() 以 security definer 身份写入
drop policy if exists claims_select_self on public.code_claims;
create policy claims_select_self on public.code_claims
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists claims_select_mod on public.code_claims;
create policy claims_select_mod on public.code_claims
  for select to authenticated using (public.is_moderator());

-- code_reports --------------------------------------------------------------
drop policy if exists reports_insert_self on public.code_reports;
create policy reports_insert_self on public.code_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

drop policy if exists reports_select_self on public.code_reports;
create policy reports_select_self on public.code_reports
  for select to authenticated using (auth.uid() = reporter_id);

drop policy if exists reports_select_mod on public.code_reports;
create policy reports_select_mod on public.code_reports
  for select to authenticated using (public.is_moderator());

-- moderation_logs -----------------------------------------------------------
-- 仅审核员可读；写入只由触发器（security definer）完成
drop policy if exists logs_select_mod on public.moderation_logs;
create policy logs_select_mod on public.moderation_logs
  for select to authenticated using (public.is_moderator());

-- ---------------------------------------------------------------------------
-- 授权（RLS 之上的基础表权限）
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select, insert, update on public.invite_codes to authenticated;
grant select on public.code_claims to authenticated;
grant select, insert on public.code_reports to authenticated;
grant select on public.moderation_logs to authenticated;
grant select on public.profiles to authenticated;
grant execute on function public.claim_code(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 示例产品种子数据（按需调整域名白名单）
-- ---------------------------------------------------------------------------
insert into public.products (name, category, icon, description, domain_whitelist)
values
  ('知行 AI',    'AI 工具',   '✦',  'AI 写作与灵感助手',   array['zhixing.ai']),
  ('拾光笔记',   '效率',      '✎',  '把零散想法整理成知识', array['shiguang.app']),
  ('画布之间',   '设计创作',  '◈',  '面向创作者的灵感画布', array['huabu.design']),
  ('代码花园',   '开发者',    '{ }','轻量开发协作工具',    array['codegarden.dev']),
  ('漫游俱乐部', '社交',      '⌁',  '和同好一起发现新城市', array['manyou.club']),
  ('灵感引擎',   'AI 工具',   '✧',  '探索你的下一个创意方向', array['lingan.engine'])
on conflict (name) do nothing;
