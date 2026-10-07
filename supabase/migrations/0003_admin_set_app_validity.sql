-- =============================================================================
-- 0003 · 管理员改已通过分类的有效期
-- =============================================================================
-- 0001 与 0002 里，管理员只能在**审批待审分类**的时候设有效期。
-- 已经通过的分类想改有效期，没有入口。这一版补上。
--
-- 语义（重要，别想当然）：
--   - validity_days 是「新码入池时的默认有效期」，改了它首先影响之后的码
--   - 那已经躺在池子里的码怎么办？0001 的列注释早就写明了规则：
--     expires_at_is_custom = false 的码，它的到期时间应当跟随应用有效期。
--     所以这里只重算 status='available' 且 expires_at_is_custom=false 的那些
--   - 已经领走的码不动。那些码的寿命已经结束，改它没有意义，还会污染大盘的历史
--   - 重算条数返回给调用方，让管理员看得见自己一次改动了多少
--
-- 幂等，可重复执行。
-- =============================================================================

create or replace function public.admin_set_app_validity(
  p_token         text,
  p_app_id        uuid,
  p_validity_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin    uuid;
  v_name     text;
  v_old      integer;
  v_affected integer;
begin
  v_admin := public.current_admin(p_token);

  if p_validity_days is null or p_validity_days < 1 or p_validity_days > 3650 then
    raise exception '有效期要落在 1 到 3650 天之间' using errcode = 'IP011';
  end if;

  select name, validity_days into v_name, v_old
  from public.apps
  where id = p_app_id and status = 'approved'
  for update;

  if v_name is null then
    raise exception '没有找到这个应用分类, 或者它已经不在用了' using errcode = 'IP005';
  end if;

  update public.apps set validity_days = p_validity_days where id = p_app_id;

  update public.invite_codes
     set expires_at = created_at + make_interval(days => p_validity_days)
   where app_id = p_app_id
     and status = 'available'
     and expires_at_is_custom = false;

  get diagnostics v_affected = row_count;

  return jsonb_build_object(
    'appId', p_app_id,
    'name', v_name,
    'oldValidityDays', v_old,
    'validityDays', p_validity_days,
    'affectedCodes', v_affected
  );
end;
$$;

comment on function public.admin_set_app_validity(text, uuid, integer) is
  '改一个已通过分类的默认有效期。只重算 available 且 expires_at_is_custom=false 的码, 已领走的不动。';


-- =============================================================================
-- 权限
-- =============================================================================
-- 和 0001 / 0002 同一套规矩: Postgres 默认把 EXECUTE 授给 PUBLIC, 先收干净再按需授回。

revoke all on function public.admin_set_app_validity(text, uuid, integer) from public;
grant execute on function public.admin_set_app_validity(text, uuid, integer) to anon, authenticated;
