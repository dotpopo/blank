-- =============================================================================
-- 0004 · 后台的操作日志
-- =============================================================================
-- T09 的最后一个交付物: 「谁在什么时候做了什么」。
--
-- 一句必须说清的话: **「谁」这件事在这个站里天然是有限的。**
-- 前台完全匿名(设计如此), 所以用户侧的 added / claimed 事件没有身份可言;
-- 管理员又是固定单账号, 所以管理动作的「谁」永远是同一个人。
-- 因此这个日志能回答的是「什么时候、对哪个分类、发生了什么」,
-- 而不是「哪个用户干的」。要做到后者得引入账号体系, 与 D-8 冲突。
--
-- 幂等, 可重复执行。
-- =============================================================================

create or replace function public.admin_events(
  p_token text,
  p_limit integer default 100
)
returns table (
  occurred_at  timestamptz,
  kind         text,
  app_name     text,
  code_preview text
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
    select e.occurred_at,
           e.kind,
           a.name,
           case
             when c.id is null then null
             else left(c.code, 2) || '...' || right(c.code, 2)
           end
    from public.pool_events e
    left join public.apps a on a.id = e.app_id
    left join public.invite_codes c on c.id = e.code_id
    order by e.occurred_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

comment on function public.admin_events(text, integer) is
  '后台的操作日志。前台匿名 + 管理员固定单账号, 所以只记「什么时候对哪个分类做了什么」, 不记「谁」。';


-- =============================================================================
-- 权限
-- =============================================================================
-- 和 0001 / 0002 / 0003 同一套规矩: 先收干净再按需授回。

revoke all on function public.admin_events(text, integer) from public;
grant execute on function public.admin_events(text, integer) to anon, authenticated;
