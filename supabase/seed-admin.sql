-- =============================================================================
-- 创建管理员账号
-- =============================================================================
-- 这是**你自己的凭据**, 所以用户名和密码由你决定。我不替你设。
--
-- 用法: 把下面两个 CHANGE_ME 换成你要的, 整段粘进 Supabase Dashboard -> SQL Editor 执行。
-- 口令用 pgcrypto 的 bcrypt (cost 12) 现算, 明文不落在任何文件里。
--
-- 想换口令就再跑一次, on conflict 会覆盖。
-- 想换用户名: 直接改第一行, 旧账号用 delete from public.admins where username = '旧名'; 删掉。
--
-- 另一种做法: 打开仓库里的 tools/password-hash.html, 离线生成哈希, 再把哈希填进
-- 下面 values 的第二个参数。效果一样, 区别是这个脚本让数据库现算。
-- =============================================================================

insert into public.admins (username, password_hash)
values (
  'CHANGE_ME_USERNAME',
  extensions.crypt('CHANGE_ME_PASSWORD', extensions.gen_salt('bf', 12))
)
on conflict (username) do update
  set password_hash = excluded.password_hash;

-- 确认: 应当看到一行, hash_prefix 是 $2a$12$
select username,
       left(password_hash, 7) as hash_prefix,
       char_length(password_hash) as hash_len,
       created_at
from public.admins;
