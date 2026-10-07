-- =============================================================================
-- 演示数据 · 只在空库上跑
-- =============================================================================
-- 这不是 schema, 是**开发用的填充数据**。目的只有一个: 让接上真实库之后
-- 首页和大盘有东西可看, 而不是一片空。
--
-- 想清掉:
--   truncate public.pool_events, public.invite_codes, public.apps restart identity cascade;
--
-- 幂等: 池子里已经有邀请码就直接跳过, 不会累加。
--
-- 数据形状刻意做成有故事的, 不是随机噪声:
--   - 码在过去 12 天里陆续入池, 不是一次性倒进去
--   - 约三分之一在入池后被人领走, 领取耗时从 1 小时到 2 天多不等
--   - 入池早 + 有效期短的, 自然过期, 不用额外造过期的数据
--   - 每个分类的库存量故意不均匀, 让水位和榜单有高低
--   - 留一个待审分类, 让管理后台有东西可审
-- =============================================================================

set search_path = public, extensions;

do $$
declare
  spec      record;
  v_app     uuid;
  v_created timestamptz;
  v_expires timestamptz;
  v_claimed timestamptz;
  v_code    text;
  i         integer;
begin
  if (select count(*) from public.invite_codes) > 0 then
    raise notice '池子里已经有数据了, 跳过播种';
    return;
  end if;

  for spec in
    select * from (values
      ('墨方',      'AI 工具', 'MF',  7, 15),
      ('Kestrel',   '开发者',  'KS', 14, 24),
      ('拾光',      '效率',    'SG', 30,  9),
      ('Camber',    '设计创作', 'CB', 10, 12),
      ('白鹿',      'AI 工具', 'BL',  5, 18),
      ('Tapebox',   '社交',    'TB', 21,  5),
      ('Northgate', '效率',    'NG', 60, 10)
    ) as t(name, category, prefix, validity_days, stock)
  loop
    insert into public.apps (name, slug, category, status, validity_days, reviewed_at)
    values (spec.name, public.app_slug(spec.name), spec.category, 'approved',
            spec.validity_days, now() - interval '30 days')
    on conflict (slug) do update
      set status = 'approved', validity_days = excluded.validity_days
    returning id into v_app;

    for i in 1..spec.stock loop
      v_created := now() - (random() * interval '12 days');
      v_expires := v_created + (spec.validity_days * (0.5 + random()) * interval '1 day');

      v_claimed := null;
      if random() < 0.34 then
        v_claimed := least(
          v_created + (1 + random() * 54) * interval '1 hour',
          v_expires - interval '1 hour',
          now() - interval '1 minute'
        );
        if v_claimed <= v_created then
          v_claimed := null;
        end if;
      end if;

      v_code := spec.prefix || '-'
        || translate(substr(md5(random()::text || i::text || spec.name), 1, 4),
                     '0123456789abcdef', 'ABCDEFGHJKLMNPQR') || '-'
        || translate(substr(md5(random()::text || i::text || spec.name || 'x'), 1, 4),
                     '0123456789abcdef', 'ABCDEFGHJKLMNPQR');

      insert into public.invite_codes
        (app_id, code, code_hash, expires_at, status, created_at, claimed_at)
      values
        (v_app, v_code,
         encode(extensions.digest(upper(regexp_replace(v_code, '[\s-]', '', 'g')), 'sha256'), 'hex'),
         v_expires,
         case when v_claimed is not null then 'claimed' else 'available' end,
         v_created, v_claimed)
      on conflict (app_id, code_hash) do nothing;

      insert into public.pool_events (kind, app_id, occurred_at)
      values ('added', v_app, v_created);

      if v_claimed is not null then
        insert into public.pool_events (kind, app_id, occurred_at)
        values ('claimed', v_app, v_claimed);
      end if;
    end loop;
  end loop;

  -- 一个待审分类, 让管理后台有东西可审
  insert into public.apps (name, slug, category, status, validity_days)
  values ('云栖笔记', public.app_slug('云栖笔记'), '效率', 'pending', 14)
  on conflict (slug) do nothing;
end $$;

select
  (select count(*) from public.apps where status = 'approved')          as approved_apps,
  (select count(*) from public.apps where status = 'pending')           as pending_apps,
  (select count(*) from public.invite_codes where status = 'available'
     and expires_at > now())                                            as available_codes,
  (select count(*) from public.invite_codes where status = 'claimed')   as claimed_codes,
  (select count(*) from public.invite_codes where status = 'available'
     and expires_at <= now())                                           as expired_unclaimed,
  (select count(*) from public.pool_events)                             as events;
