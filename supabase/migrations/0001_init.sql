-- =============================================================================
-- 邀请码共享池 · 初始 schema (T01)
-- =============================================================================
-- 用法: 整段粘贴进 Supabase Dashboard -> SQL Editor 执行。
-- 幂等: 可以重复执行。
--
-- 设计要点(与 docs/spec/invite-pool.spec.md 对应):
--   1. anon 角色拿不到任何表的直接读写权限, 只能调用 RPC。
--      否则一次请求就能把整表抓走, "前台只显示池子总数" 就只是装饰。
--   2. 领取是原子的: update ... where id = (select ... for update skip locked)。
--      并发下两个浏览器不会领到同一个码。
--   3. 过期靠查询过滤 (expires_at > now()), 不依赖定时任务。
--   4. 邀请码明文保存(领取时要还给用户), code_hash 只用于去重。
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;


-- =============================================================================
-- 表
-- =============================================================================

create table if not exists public.admins (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  constraint admins_username_len check (char_length(username) between 3 and 32)
);

comment on table public.admins is
  '固定管理员账号。password_hash 是 bcrypt ($2a$12$...), 由 tools/password-hash.html 生成后手工插入。';

create table if not exists public.apps (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  category      text not null default '其他',
  icon          text,
  description   text,
  url           text,
  validity_days integer not null default 30
                check (validity_days between 1 and 3650),
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.admins(id) on delete set null,
  reject_reason text,
  constraint apps_name_len check (char_length(name) between 1 and 80),
  constraint apps_rejected_needs_reason
    check (status <> 'rejected' or reject_reason is not null)
);

comment on column public.apps.slug is
  '应用名的归一化键, 用于合并重复提交 (spec 11.8)。规则见 app_slug()。';
comment on column public.apps.validity_days is
  '该应用邀请码的默认有效期(天)。新增邀请码时若不指定到期时间, 就用它。';

create table if not exists public.invite_codes (
  id                    uuid primary key default gen_random_uuid(),
  app_id                uuid not null references public.apps(id) on delete cascade,
  code                  text not null,
  code_hash             text not null unique,
  note                  text,
  expires_at            timestamptz not null,
  expires_at_is_custom  boolean not null default false,
  status                text not null default 'available'
                        check (status in ('available', 'claimed', 'removed')),
  created_at            timestamptz not null default now(),
  claimed_at            timestamptz,
  claim_token           text,
  contributor_token     text,
  constraint invite_codes_len check (char_length(code) between 1 and 512),
  constraint invite_codes_claimed_has_time
    check (status <> 'claimed' or claimed_at is not null)
);

comment on column public.invite_codes.code_hash is
  'sha256(去首尾空白后的码)。唯一索引用于去重, 不是安全措施。大小写敏感。';
comment on column public.invite_codes.expires_at_is_custom is
  'true 表示提交者显式指定了到期时间。应用被审核通过并设置有效期时, 只覆盖 false 的那些。';

create table if not exists public.pool_events (
  id          bigserial primary key,
  kind        text not null check (kind in (
                'added', 'claimed', 'removed',
                'app_submitted', 'app_approved', 'app_rejected'
              )),
  app_id      uuid references public.apps(id) on delete set null,
  code_id     uuid,
  occurred_at timestamptz not null default now()
);

comment on table public.pool_events is
  '大盘的数据源。写入发生在各 RPC 内部, 不靠事后反推。';

create table if not exists public.admin_sessions (
  token_hash   text primary key,
  admin_id     uuid not null references public.admins(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now()
);

comment on table public.admin_sessions is
  '管理员会话。只存 token 的 sha256, 不存 token 本身。';


-- =============================================================================
-- 索引
-- =============================================================================

create index if not exists invite_codes_available_expiry_idx
  on public.invite_codes (expires_at, created_at)
  where status = 'available';

create index if not exists invite_codes_app_status_idx
  on public.invite_codes (app_id, status);

create index if not exists invite_codes_claimed_idx
  on public.invite_codes (claimed_at desc)
  where status = 'claimed';

create index if not exists apps_status_submitted_idx
  on public.apps (status, submitted_at desc);

create index if not exists pool_events_occurred_idx
  on public.pool_events (occurred_at desc);

create index if not exists pool_events_kind_occurred_idx
  on public.pool_events (kind, occurred_at desc);

create index if not exists admin_sessions_expires_idx
  on public.admin_sessions (expires_at);


-- =============================================================================
-- 辅助函数
-- =============================================================================

-- 应用名 -> 归一化键。去掉所有空白并转小写, 用于合并 "ChatGPT" / "chat gpt"。
create or replace function public.app_slug(p_name text)
returns text
language sql
immutable
as $$
  select left(
    lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', '', 'g')),
    120
  )
$$;

-- 当前 token 对应的管理员 id。没有有效会话时抛错。
create or replace function public.current_admin(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception '管理会话无效, 请重新登录' using errcode = 'IP008';
  end if;

  update public.admin_sessions s
     set last_seen_at = now()
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and s.expires_at > now()
  returning s.admin_id into v_admin_id;

  if v_admin_id is null then
    raise exception '登录已过期, 请重新登录' using errcode = 'IP009';
  end if;

  return v_admin_id;
end;
$$;


-- =============================================================================
-- 公开 RPC (匿名可调用)
-- =============================================================================

-- 水位: 池子总数与今日进出。
create or replace function public.pool_summary()
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  select jsonb_build_object(
    'total', count(*) filter (
      where c.status = 'available' and c.expires_at > now()
    ),
    'addedToday', count(*) filter (where c.created_at >= current_date),
    'claimedToday', count(*) filter (where c.claimed_at >= current_date),
    'expiredPending', count(*) filter (
      where c.status = 'available' and c.expires_at <= now()
    ),
    'approvedApps', count(distinct c.app_id) filter (
      where c.status = 'available' and c.expires_at > now()
    )
  )
  from public.invite_codes c
  join public.apps a on a.id = c.app_id and a.status = 'approved'
$$;

-- 可领列表。**不返回码文** (spec Q3): 码只在领取时才揭示。
-- p_sort: 'newest' 按加入时间倒序 (用户原话「最新的 20 个」);
--         'expiring' 按到期紧迫度升序 (spec 11.2 建议的「快过期的先被看见」)。
create or replace function public.latest_available(
  p_limit integer default 20,
  p_sort  text default 'newest'
)
returns table (
  code_id      uuid,
  app_id       uuid,
  app_name     text,
  app_icon     text,
  app_category text,
  expires_at   timestamptz,
  seconds_left bigint,
  created_at   timestamptz
)
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  select c.id,
         a.id,
         a.name,
         a.icon,
         a.category,
         c.expires_at,
         greatest(0, extract(epoch from (c.expires_at - now()))::bigint),
         c.created_at
  from public.invite_codes c
  join public.apps a on a.id = c.app_id
  where c.status = 'available'
    and c.expires_at > now()
    and a.status = 'approved'
  order by
    case when coalesce(p_sort, 'newest') = 'expiring'
         then c.expires_at end asc nulls last,
    case when coalesce(p_sort, 'newest') <> 'expiring'
         then c.created_at end desc nulls last,
    c.expires_at asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- 领取一个指定的码。原子操作。
create or replace function public.claim_code(
  p_code_id    uuid,
  p_browser_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code     text;
  v_app_id   uuid;
  v_app_name text;
  v_expires  timestamptz;
begin
  if p_code_id is null then
    raise exception '缺少邀请码标识' using errcode = 'IP011';
  end if;

  update public.invite_codes c
     set status       = 'claimed',
         claimed_at   = now(),
         claim_token  = left(coalesce(p_browser_id, ''), 64)
   where c.id = (
     select id
       from public.invite_codes
      where id = p_code_id
        and status = 'available'
        and expires_at > now()
      for update skip locked
   )
  returning c.code, c.app_id, c.expires_at
       into v_code, v_app_id, v_expires;

  if v_code is null then
    -- 区分几种失败, 让用户看到能理解的话, 而不是统一的 "操作失败"。
    if exists (select 1 from public.invite_codes
                where id = p_code_id and status = 'claimed') then
      raise exception '这个邀请码刚刚被别人领走了' using errcode = 'IP001';
    elsif exists (select 1 from public.invite_codes
                   where id = p_code_id and expires_at <= now()) then
      raise exception '这个邀请码已经过期了' using errcode = 'IP003';
    else
      raise exception '没有找到这个邀请码' using errcode = 'IP002';
    end if;
  end if;

  select a.name into v_app_name from public.apps a where a.id = v_app_id;

  insert into public.pool_events (kind, app_id, code_id)
  values ('claimed', v_app_id, p_code_id);

  return jsonb_build_object(
    'code', v_code,
    'appId', v_app_id,
    'appName', v_app_name,
    'expiresAt', v_expires
  );
end;
$$;

-- 骰子: 随机取一个码。**加权**, 不是均匀随机 (spec 11.4)。
-- 越临期的码权重越高, 于是骰子同时充当清仓机制。
-- 权重 w = 1/rn (rn 是临期排名)。按 random()^rn 降序取第一个, 即加权采样。
create or replace function public.roll_dice(p_browser_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  with candidates as (
    select c.id
      from public.invite_codes c
      join public.apps a on a.id = c.app_id and a.status = 'approved'
     where c.status = 'available'
       and c.expires_at > now()
     order by c.expires_at asc, c.created_at asc
     limit 20
  ),
  ranked as (
    select id, row_number() over () as rn from candidates
  )
  select id into v_id
    from ranked
   order by power(random(), rn) desc
   limit 1;

  if v_id is null then
    raise exception '池子现在是空的, 没有可以抽的邀请码' using errcode = 'IP010';
  end if;

  return public.claim_code(v_id, p_browser_id);
end;
$$;

-- 贡献一个邀请码。
-- 已上架应用: 立即入池。待审应用: 先存着, 应用通过审核后自动可见。
create or replace function public.contribute_code(
  p_app_id     uuid,
  p_code       text,
  p_note       text default null,
  p_expires_at timestamptz default null,
  p_browser_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_app      public.apps%rowtype;
  v_code     text;
  v_expires  timestamptz;
  v_is_custom boolean;
  v_id       uuid;
  v_visible  boolean;
begin
  v_code := btrim(coalesce(p_code, ''));

  if v_code = '' or char_length(v_code) > 512 then
    raise exception '邀请码不能为空, 且不超过 512 个字符' using errcode = 'IP011';
  end if;

  select * into v_app from public.apps where id = p_app_id;
  if not found then
    raise exception '没有找到这个应用' using errcode = 'IP005';
  end if;
  if v_app.status = 'rejected' then
    raise exception '这个应用的申请没有通过, 暂时不能添加邀请码' using errcode = 'IP006';
  end if;

  v_is_custom := p_expires_at is not null;
  v_expires   := coalesce(p_expires_at, now() + make_interval(days => v_app.validity_days));

  if v_expires <= now() then
    raise exception '有效期必须晚于当前时间' using errcode = 'IP011';
  end if;

  begin
    insert into public.invite_codes
      (app_id, code, code_hash, note, expires_at, expires_at_is_custom, contributor_token)
    values
      (p_app_id,
       v_code,
       encode(digest(v_code, 'sha256'), 'hex'),
       nullif(btrim(coalesce(p_note, '')), ''),
       v_expires,
       v_is_custom,
       left(coalesce(p_browser_id, ''), 64))
    returning id into v_id;
  exception
    when unique_violation then
      raise exception '这个邀请码已经在池子里了' using errcode = 'IP004';
  end;

  insert into public.pool_events (kind, app_id, code_id)
  values ('added', p_app_id, v_id);

  v_visible := v_app.status = 'approved';

  return jsonb_build_object(
    'codeId', v_id,
    'appId', p_app_id,
    'appName', v_app.name,
    'expiresAt', v_expires,
    'appStatus', v_app.status,
    'visibleNow', v_visible
  );
end;
$$;

-- 提交一个新应用。命中已有应用时**合并**, 不新建 (spec 11.8)。
-- 返回 kind: 'merged' | 'attached_pending' | 'created'。
create or replace function public.submit_app(
  p_name          text,
  p_category      text default '其他',
  p_icon          text default null,
  p_description   text default null,
  p_url           text default null,
  p_validity_days integer default 30,
  p_code          text default null,
  p_note          text default null,
  p_browser_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_name  text;
  v_slug  text;
  v_app   public.apps%rowtype;
  v_kind  text;
  v_code_result jsonb;
begin
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' or char_length(v_name) > 80 then
    raise exception '应用名不能为空, 且不超过 80 个字符' using errcode = 'IP011';
  end if;
  if coalesce(p_validity_days, 30) not between 1 and 3650 then
    raise exception '有效期天数需要在 1 到 3650 之间' using errcode = 'IP011';
  end if;

  v_slug := public.app_slug(v_name);
  if v_slug = '' then
    raise exception '应用名至少要包含一个可见字符' using errcode = 'IP011';
  end if;

  select * into v_app from public.apps where slug = v_slug;

  if found then
    if v_app.status = 'approved' then
      v_kind := 'merged';
    elsif v_app.status = 'pending' then
      v_kind := 'attached_pending';
    else
      raise exception '这个应用的申请之前没有通过, 请联系管理员' using errcode = 'IP006';
    end if;
  else
    insert into public.apps
      (slug, name, category, icon, description, url, validity_days, status)
    values
      (v_slug, v_name,
       nullif(btrim(coalesce(p_category, '')), '') is null and '其他' or btrim(p_category),
       nullif(btrim(coalesce(p_icon, '')), ''),
       nullif(btrim(coalesce(p_description, '')), ''),
       nullif(btrim(coalesce(p_url, '')), ''),
       coalesce(p_validity_days, 30),
       'pending')
    returning * into v_app;

    v_kind := 'created';

    insert into public.pool_events (kind, app_id)
    values ('app_submitted', v_app.id);
  end if;

  if nullif(btrim(coalesce(p_code, '')), '') is not null then
    v_code_result := public.contribute_code(v_app.id, p_code, p_note, null, p_browser_id);
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'appId', v_app.id,
    'appName', v_app.name,
    'appStatus', v_app.status,
    'validityDays', v_app.validity_days,
    'code', v_code_result
  );
end;
$$;

-- 已上架应用列表, 供贡献表单搜索。
create or replace function public.list_apps(
  p_query text default null,
  p_limit integer default 50
)
returns table (
  app_id       uuid,
  name         text,
  category     text,
  icon         text,
  description  text,
  validity_days integer,
  pool_count   bigint
)
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  select a.id,
         a.name,
         a.category,
         a.icon,
         a.description,
         a.validity_days,
         count(c.id) filter (
           where c.status = 'available' and c.expires_at > now()
         )
  from public.apps a
  left join public.invite_codes c on c.app_id = a.id
  where a.status = 'approved'
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or a.name ilike '%' || btrim(p_query) || '%'
      or a.category ilike '%' || btrim(p_query) || '%'
    )
  group by a.id
  order by count(c.id) filter (
             where c.status = 'available' and c.expires_at > now()
           ) desc,
           a.name asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- 大盘趋势。
create or replace function public.pool_trend(p_days integer default 7)
returns table (day date, added bigint, claimed bigint, expired_unclaimed bigint)
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  with params as (
    select greatest(least(coalesce(p_days, 7), 90), 1) as n
  ),
  span as (
    select d::date as day
    from params p,
         generate_series(
           current_date - (p.n - 1),
           current_date,
           interval '1 day'
         ) as d
  ),
  flow as (
    select e.occurred_at::date as day,
           count(*) filter (where e.kind = 'added')   as added,
           count(*) filter (where e.kind = 'claimed') as claimed
    from public.pool_events e, params p
    where e.occurred_at >= current_date - (p.n - 1)
    group by 1
  ),
  gone as (
    select c.expires_at::date as day, count(*) as n
    from public.invite_codes c, params p
    where c.status = 'available'
      and c.expires_at < now()
      and c.expires_at >= current_date - (p.n - 1)
    group by 1
  )
  select s.day,
         coalesce(f.added, 0),
         coalesce(f.claimed, 0),
         coalesce(g.n, 0)
  from span s
  left join flow f on f.day = s.day
  left join gone g on g.day = s.day
  order by s.day
$$;

-- 池子健康度。中位领取时长是最重要的一个数字 (spec 11.3)。
create or replace function public.pool_health()
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  select jsonb_build_object(
    'medianTimeToClaimSeconds', (
      select percentile_cont(0.5) within group (
               order by extract(epoch from (c.claimed_at - c.created_at))
             )
      from public.invite_codes c
      where c.status = 'claimed' and c.claimed_at is not null
    ),
    'claimedTotal', (
      select count(*) from public.invite_codes where status = 'claimed'
    ),
    'expiredUnclaimedTotal', (
      select count(*) from public.invite_codes
      where status = 'available' and expires_at <= now()
    ),
    'oldestAvailableAt', (
      select min(c.created_at) from public.invite_codes c
      where c.status = 'available' and c.expires_at > now()
    ),
    'approvedApps', (select count(*) from public.apps where status = 'approved'),
    'pendingApps',  (select count(*) from public.apps where status = 'pending')
  )
$$;


-- =============================================================================
-- 管理员 RPC
-- =============================================================================

create or replace function public.admin_login(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin public.admins%rowtype;
  v_token text;
  v_hours integer := 8;
begin
  select * into v_admin
    from public.admins
   where username = btrim(coalesce(p_username, ''));

  -- 用户名不存在与密码错误返回同一个错误, 不泄露用户名是否存在。
  if not found
     or v_admin.password_hash <> crypt(coalesce(p_password, ''), v_admin.password_hash) then
    raise exception '用户名或密码不正确' using errcode = 'IP007';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.admin_sessions (token_hash, admin_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'),
          v_admin.id,
          now() + make_interval(hours => v_hours));

  delete from public.admin_sessions where expires_at < now();

  return jsonb_build_object(
    'token', v_token,
    'username', v_admin.username,
    'expiresInSeconds', v_hours * 3600
  );
end;
$$;

create or replace function public.admin_pending_apps(p_token text)
returns table (
  app_id       uuid,
  name         text,
  category     text,
  icon         text,
  description  text,
  url          text,
  validity_days integer,
  submitted_at timestamptz,
  code_count   bigint
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin uuid;
begin
  v_admin := public.current_admin(p_token);

  return query
    select a.id, a.name, a.category, a.icon, a.description, a.url,
           a.validity_days, a.submitted_at,
           count(c.id)
    from public.apps a
    left join public.invite_codes c
      on c.app_id = a.id and c.status = 'available'
    where a.status = 'pending'
    group by a.id
    order by a.submitted_at asc;
end;
$$;

create or replace function public.admin_review_app(
  p_token         text,
  p_app_id        uuid,
  p_approve       boolean,
  p_validity_days integer default null,
  p_reason        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin uuid;
  v_app   public.apps%rowtype;
  v_days  integer;
  v_touched integer := 0;
begin
  v_admin := public.current_admin(p_token);

  select * into v_app from public.apps where id = p_app_id for update;
  if not found then
    raise exception '没有找到这个应用' using errcode = 'IP005';
  end if;

  if p_approve then
    v_days := coalesce(p_validity_days, v_app.validity_days);
    if v_days not between 1 and 3650 then
      raise exception '有效期天数需要在 1 到 3650 之间' using errcode = 'IP011';
    end if;

    update public.apps
       set status        = 'approved',
           validity_days = v_days,
           reviewed_at   = now(),
           reviewed_by   = v_admin,
           reject_reason = null
     where id = p_app_id;

    -- 审核期间收到的码, 按新有效期重算到期时间。
    -- 提交者显式指定过到期时间的那些不动。
    update public.invite_codes
       set expires_at = created_at + make_interval(days => v_days)
     where app_id = p_app_id
       and status = 'available'
       and expires_at_is_custom = false;
    get diagnostics v_touched = row_count;

    insert into public.pool_events (kind, app_id)
    values ('app_approved', p_app_id);
  else
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception '驳回需要填写理由' using errcode = 'IP011';
    end if;

    update public.apps
       set status        = 'rejected',
           reviewed_at   = now(),
           reviewed_by   = v_admin,
           reject_reason = btrim(p_reason)
     where id = p_app_id;

    update public.invite_codes
       set status = 'removed'
     where app_id = p_app_id and status = 'available';
    get diagnostics v_touched = row_count;

    insert into public.pool_events (kind, app_id)
    values ('app_rejected', p_app_id);
  end if;

  return jsonb_build_object(
    'appId', p_app_id,
    'status', case when p_approve then 'approved' else 'rejected' end,
    'validityDays', case when p_approve then v_days else null end,
    'codesAffected', v_touched
  );
end;
$$;

create or replace function public.admin_apps(
  p_token text,
  p_status text default null
)
returns table (
  app_id        uuid,
  name          text,
  category      text,
  icon          text,
  status        text,
  validity_days integer,
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  reject_reason text,
  available_codes bigint,
  claimed_codes   bigint
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin uuid;
begin
  v_admin := public.current_admin(p_token);

  return query
    select a.id, a.name, a.category, a.icon, a.status, a.validity_days,
           a.submitted_at, a.reviewed_at, a.reject_reason,
           count(c.id) filter (where c.status = 'available' and c.expires_at > now()),
           count(c.id) filter (where c.status = 'claimed')
    from public.apps a
    left join public.invite_codes c on c.app_id = a.id
    where p_status is null or a.status = p_status
    group by a.id
    order by a.submitted_at desc
    limit 500;
end;
$$;

create or replace function public.admin_codes(
  p_token  text,
  p_app_id uuid default null,
  p_status text default null,
  p_limit  integer default 200
)
returns table (
  code_id      uuid,
  app_id       uuid,
  app_name     text,
  code_preview text,
  status       text,
  expires_at   timestamptz,
  created_at   timestamptz,
  claimed_at   timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin uuid;
begin
  v_admin := public.current_admin(p_token);

  return query
    select c.id, c.app_id, a.name,
           -- 后台也不整条回显, 只给前 4 位 + 长度, 够定位就行。
           left(c.code, 4) || '...(' || char_length(c.code) || ')',
           c.status, c.expires_at, c.created_at, c.claimed_at
    from public.invite_codes c
    join public.apps a on a.id = c.app_id
    where (p_app_id is null or c.app_id = p_app_id)
      and (p_status is null or c.status = p_status)
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

-- 决策 D-11: 管理员不删邀请码, 所以这里原本的 admin_remove_code 被移除。
-- 管理员对邀请码只有只读权限(见 admin_codes)。
-- 应用分类的新增与删除是 T09 的范围, 会以 0002 迁移补上。

-- 清理已经过期且没被领走的码。
create or replace function public.admin_cleanup_expired(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin uuid;
  v_count integer;
begin
  v_admin := public.current_admin(p_token);

  with gone as (
    delete from public.invite_codes
     where status = 'available'
       and expires_at <= now()
    returning id, app_id
  )
  insert into public.pool_events (kind, app_id, code_id)
  select 'removed', app_id, id from gone;

  get diagnostics v_count = row_count;

  return jsonb_build_object('removed', v_count);
end;
$$;

create or replace function public.admin_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.admin_sessions
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return jsonb_build_object('loggedOut', true);
end;
$$;


-- =============================================================================
-- 权限
-- =============================================================================
-- 关键一步。Postgres 默认把函数的 EXECUTE 授给 PUBLIC, 必须显式收回。

alter table public.admins         enable row level security;
alter table public.apps           enable row level security;
alter table public.invite_codes   enable row level security;
alter table public.pool_events    enable row level security;
alter table public.admin_sessions enable row level security;

-- 一条 policy 都不建, 于是 anon / authenticated 对这几张表的直接读写全部被拒。
-- 再加一层保险: 把 Supabase 默认授出的表权限也收掉。
revoke all on public.admins         from anon, authenticated;
revoke all on public.apps           from anon, authenticated;
revoke all on public.invite_codes   from anon, authenticated;
revoke all on public.pool_events    from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;
revoke all on sequence public.pool_events_id_seq from anon, authenticated;

-- 先收掉所有函数的默认权限, 再按需授回。
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'pool_summary', 'latest_available', 'claim_code', 'roll_dice',
        'contribute_code', 'submit_app', 'list_apps',
        'pool_trend', 'pool_health',
        'admin_login', 'admin_pending_apps', 'admin_review_app',
        'admin_apps', 'admin_codes',
        'admin_cleanup_expired', 'admin_logout'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;

-- app_slug / current_admin 不给 anon 直接调用。
revoke all on function public.app_slug(text) from public;
revoke all on function public.current_admin(text) from public;


-- =============================================================================
-- 初始数据
-- =============================================================================
-- 管理员账号不在这里插。密码哈希要用 tools/password-hash.html 生成, 然后:
--
--   insert into public.admins (username, password_hash)
--   values ('你的用户名', '$2a$12$把生成器输出的整串粘到这里')
--   on conflict (username) do update set password_hash = excluded.password_hash;
--
-- =============================================================================
