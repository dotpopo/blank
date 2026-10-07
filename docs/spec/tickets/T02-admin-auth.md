# T02 · 管理员认证与密码生成器

| | |
|---|---|
| 依赖 | T01 |
| 阻塞 | T09 |
| 预估会话数 | 1 |

## 目标

管理员能登录,而**密码的哈希值由你在网页上生成后直接写进数据库**。
服务端不需要任何额外服务(不用 Edge Function),校验完全在 Postgres 里完成。

## 加密算法(交付说明,写清楚给用户)

- **算法**: bcrypt
- **cost**: 12
- **存储格式**: `$2a$12$<22字符salt><31字符hash>`,共 60 字符
- **服务端校验**: `select ... where username = $1 and password_hash = crypt($2, password_hash)`
  (`crypt` 与 `gen_salt` 来自 `pgcrypto`)
- **生成方式**: 浏览器端用 bcryptjs 计算,纯前端,不联网,不落盘

> 为什么不用 PBKDF2-WebCrypto: 那需要服务端也用 PBKDF2 校验,而 Postgres 没有原生 PBKDF2。
> bcrypt 是唯一「浏览器能算、Postgres 能验」且不引入额外服务的选项。

## 交付物

- [x] `tools/password-hash.html`: **单文件**密码生成器。
  - 输入明文 → 输出可直接粘贴进 SQL 的 `$2a$12$...`
  - 显示生成耗时(让用户感知 cost 12 的代价)
  - 提供现成的 `insert into admins (username, password_hash) values (...)` 语句
  - 不联网、不发请求、不写 localStorage
  - 页面顶部明确标注「本地工具,不要在公共电脑上使用」
- [x] `admin_login(p_username, p_password)` RPC 实现完成,返回短期 token(见 Q6)。
- [x] token 的签发与校验规则写进 spec 或 `AGENTS.md`:
      有效期、存储位置(`sessionStorage`)、失效方式。
- [x] `docs/spec/tickets/T02-admin-auth.md` 里补充**实际生成的示例哈希**(用一个测试密码),
      > 已补。`test-password-for-reference-only` 的 bcrypt 哈希(cost 12, 由 pgcrypto 现算):
      > `$2a$12$FR9uiHeL6z27oFwyOdPIJ.IcBVeKe6S8smy9qfejRaokplXNRQPZC`
      > **这只是格式参考, 不是任何账号的凭据。** 你自己的口令请用 `supabase/seed-admin.sql`
      > 或 `tools/password-hash.html` 生成。
      方便 T09 直接拿去做联调。

## 验收

- 用生成器产出的哈希,`insert` 进 `admins` 后,`admin_login` 用正确密码返回 token、错误密码被拒。
- 同一个密码两次生成得到**不同**哈希(salt 随机),但都能通过校验。
- 生成器在断网状态下可用。

## 不做什么

- 不做注册、不做找回密码、不做多管理员管理界面。
- 不用 Supabase Auth(见 spec D4)。
- 不把真实密码写进仓库任何文件。
