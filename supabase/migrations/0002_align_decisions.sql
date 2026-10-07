-- =============================================================================
-- 0002 · 对齐决策台账, 并补上大盘真正需要的数据
-- =============================================================================
-- 依赖 0001。幂等, 可重复执行。
--
-- 这一版做四件事:
--   1. 修 D-5 没落地的部分: code_hash 从全局唯一改成 (app_id, code_hash) 复合唯一
--   2. 让 D-11 落得下去: apps.status 允许 archived, pool_events.kind 允许分类增删事件
--   3. 补大盘缺的数: pool_trend 加净水位列, pool_health 加数据起始时间,
--      新增 pool_app_ranking 供「消耗最快 / 积压最多」用
--   4. 补 D-11 要的两个 RPC: 管理员新增 / 删除应用分类
-- =============================================================================


-- =============================================================================
-- 1. D-5: 同应用内去重, 不是全局去重
-- =============================================================================
-- 0001 里 code_hash 是 unique 单列, 等于同一个码不能出现在两个应用下。
-- 但决策 D-5 定的是「同一应用下唯一, 跨应用允许重复」。

alter table public.invite_codes
  drop constraint if exists invite_codes_code_hash_key;

create unique index if not exists invite_codes_app_code_hash_key
  on public.invite_codes (app_id, code_hash);

comment on column public.invite_codes.code_hash is
  'sha256(去首尾空白后的码)。(app_id, code_hash) 唯一, 即同应用内去重, 跨应用允许重复 (决策 D-5)。不是安全措施。';


-- =============================================================================
-- 2. 让 D-11 落得下去
-- =============================================================================

-- 归档态。删一个分类不物理删, 理由同 D-2: 它下面的码和大盘流水都还要留着。
alter table public.apps
  drop constraint if exists apps_status_check;
alter table public.apps
  add constraint apps_status_check
  check (status in ('pending', 'approved', 'rejected', 'archived'));

comment on column public.apps.status is
  'pending 待审 / approved 可用 / rejected 被拒 / archived 已归档 (前台与 RPC 都不再返回, 决策 D-11)。';

-- 分类增删也要留事件, 否则大盘看不出「上游供给在不在增长」。
alter table public.pool_events
  drop constraint if exists pool_events_kind_check;
alter table public.pool_events
  add constraint pool_events_kind_check
  check (kind in (
    'added', 'claimed', 'removed',
    'app_submitted', 'app_approved', 'app_rejected',
    'app_added', 'app_archived'
  ));


-- =============================================================================
-- 3. 大盘缺的数
-- =============================================================================

-- 净水位: 每天结束时的池子存量。
-- 这是存量, 和 added/claimed 那两个日流量不是一个量纲, 前端要单独一条轴画。
-- 签名变了 (多一列), 所以必须先 drop。
drop function if exists public.pool_trend(integer);

create or replace function public.pool_trend(p_days integer default 7)
returns table (
  day date,
  added bigint,
  claimed bigint,
  expired_unclaimed bigint,
  net bigint
)
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
         coalesce(g.n, 0),
         (
           select count(*)
           from public.invite_codes c
           where c.created_at < least((s.day + 1)::timestamptz, now())
             and (c.claimed_at is null or c.claimed_at >= least((s.day + 1)::timestamptz, now()))
             and c.expires_at > least((s.day + 1)::timestamptz, now())
         ) as net
  from span s
  left join flow f on f.day = s.day
  left join gone g on g.day = s.day
  order by s.day
$$;

comment on function public.pool_trend(integer) is
  '大盘趋势。区间内每一天都返回, 没事件的日子计 0, 所以前端分不清「没数据」和「真的没有事件」, 要靠 pool_health.firstDataAt 判断覆盖范围。net 是当天结束时的存量。';

-- pool_health 补一个数据起始时间。有了它, 前端才知道自己手里有几天数据,
-- 才能在大盘上如实说「这个区间只有 N 天有数据」, 而不是画一条看着很可信的假曲线。
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
    'claimSampleSize', (
      select count(*) from public.invite_codes
      where status = 'claimed' and claimed_at is not null
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
    'firstDataAt', least(
      (select min(occurred_at) from public.pool_events),
      (select min(created_at) from public.invite_codes)
    ),
    'approvedApps', (select count(*) from public.apps where status = 'approved'),
    'pendingApps',  (select count(*) from public.apps where status = 'pending')
  )
$$;

-- 应用维度的榜单。消耗最快看区间内的领取数, 积压最多看当前存量。
create or replace function public.pool_app_ranking(p_days integer default 30)
returns table (app_id uuid, app_name text, claimed bigint, available bigint)
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  with params as (
    select greatest(least(coalesce(p_days, 30), 365), 1) as n
  ),
  drain as (
    select e.app_id, count(*) as claimed
    from public.pool_events e, params p
    where e.kind = 'claimed'
      and e.occurred_at >= current_date - (p.n - 1)
      and e.app_id is not null
    group by 1
  ),
  stock as (
    select c.app_id, count(*) as available
    from public.invite_codes c
    where c.status = 'available' and c.expires_at > now()
    group by 1
  )
  select a.id, a.name,
         coalesce(d.claimed, 0),
         coalesce(s.available, 0)
  from public.apps a
  left join drain d on d.app_id = a.id
  left join stock s on s.app_id = a.id
  where a.status = 'approved'
    and (coalesce(d.claimed, 0) > 0 or coalesce(s.available, 0) > 0)
  order by coalesce(d.claimed, 0) desc, coalesce(s.available, 0) desc
$$;


-- =============================================================================
-- 4. D-11: 管理员新增 / 删除应用分类
-- =============================================================================
-- 管理员不碰邀请码 (0001 里已移除 admin_remove_code)。他管的是分类本身。

create or replace function public.admin_add_app(
  p_token         text,
  p_name          text,
  p_category      text default '其他',
  p_validity_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin uuid;
  v_name  text;
  v_slug  text;
  v_id    uuid;
begin
  v_admin := public.current_admin(p_token);

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception '应用名不能为空' using errcode = 'IP011';
  end if;
  if p_validity_days is null or p_validity_days < 1 or p_validity_days > 3650 then
    raise exception '有效期要落在 1 到 3650 天之间' using errcode = 'IP011';
  end if;

  v_slug := public.app_slug(v_name);

  insert into public.apps (name, slug, category, status, validity_days, reviewed_at, reviewed_by)
  values (v_name, v_slug, coalesce(nullif(btrim(p_category), ''), '其他'),
          'approved', p_validity_days, now(), v_admin)
  on conflict (slug) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception '「%」已经在列表里了', v_name using errcode = 'IP004';
  end if;

  insert into public.pool_events (kind, app_id) values ('app_added', v_id);

  return jsonb_build_object(
    'appId', v_id, 'name', v_name, 'slug', v_slug, 'validityDays', p_validity_days
  );
end;
$$;

-- 删一个分类 = 归档。
-- 不物理删, 理由和 D-2 一致: 它下面的邀请码和大盘流水都要留着。
-- 归档之后: 分类从前台和 list_apps 消失, 它的码不再可领, 但历史还在。
create or replace function public.admin_remove_app(
  p_token  text,
  p_app_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin     uuid;
  v_name      text;
  v_abandoned integer;
begin
  v_admin := public.current_admin(p_token);

  select name into v_name
  from public.apps
  where id = p_app_id and status <> 'archived'
  for update;

  if v_name is null then
    raise exception '没有找到这个应用分类, 或者它已经归档了' using errcode = 'IP005';
  end if;

  select count(*) into v_abandoned
  from public.invite_codes
  where app_id = p_app_id and status = 'available' and expires_at > now();

  update public.apps set status = 'archived' where id = p_app_id;

  insert into public.pool_events (kind, app_id) values ('app_archived', p_app_id);

  return jsonb_build_object(
    'appId', p_app_id, 'name', v_name, 'archived', true, 'abandonedCodes', v_abandoned
  );
end;
$$;

comment on function public.admin_remove_app(text, uuid) is
  '归档一个应用分类 (决策 D-11)。返回被一并作废的可用码数量。不物理删, 见 D-2。';


-- =============================================================================
-- 5. 权限
-- =============================================================================
-- 和 0001 同一套规矩: Postgres 默认把 EXECUTE 授给 PUBLIC, 所以先收干净再按需授回。

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
        'pool_trend', 'pool_health', 'pool_app_ranking',
        'admin_add_app', 'admin_remove_app'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
