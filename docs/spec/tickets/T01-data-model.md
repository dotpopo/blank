# T01 · 数据模型与 RPC 骨架

| | |
|---|---|
| 依赖 | T00 |
| 阻塞 | T02, T03, T04 |
| 预估会话数 | 1 |

## 目标

把 spec 第 6 节的模型落成可执行的 SQL,并把**权限面**一次定死。
这一张工单决定了整个项目的安全姿态,后面的工单都建立在它的约束之上。

## 交付物

- [x] `supabase/migrations/0001_init.sql`(或等价的可粘贴 SQL),包含:
  - `apps` / `invite_codes` / `admins` / `pool_events` 四张表(字段见 spec 第 6 节)
  - 索引: `invite_codes(status, expires_at)`, `invite_codes(app_id, status)`,
    `pool_events(occurred_at)`, `apps(status, submitted_at desc)`
  - `invite_codes.code_hash` 唯一索引(去重,见 spec 11.5)
  - 扩展: `pgcrypto`(bcrypt 用)
- [x] **RLS 策略**: 四张表**全部 enable RLS**,并且**不给 anon 任何直接 SELECT/INSERT/UPDATE/DELETE 权限**。
      所有访问只经由 RPC。这是 D1。
- [x] RPC 骨架(签名 + `SECURITY DEFINER` + `search_path` 固定),业务体可以留 TODO:
      `pool_summary` / `latest_available` / `claim_code` / `roll_dice` /
      `contribute_code` / `submit_app` / `pool_trend` /
      `admin_login` / `admin_review_app` / `admin_remove_code` / `admin_pending_apps`
- [x] `GRANT EXECUTE` 只给需要的角色。`admin_*` 系列**不给 anon**,或强制要求 token 参数。
- [x] 每个 RPC 的**错误码**清单(用 `raise exception` 的 `errcode` 或约定前缀),前端 T03 直接消费。

## 关键实现约束

- `claim_code` 必须是**原子**的:
  ```sql
  update invite_codes set status='claimed', claimed_at=now()
  where id = (select id from invite_codes
              where id = p_code_id and status='available' and expires_at > now()
              for update skip locked)
  returning code;
  ```
  取不到就返回明确的「已被领走」错误,不能让两个并发请求拿到同一个码。
- `latest_available` **不得返回 `code` 字段**。只返回应用信息、`expires_at`、`id`。见 Q3。
- 排序按 `expires_at asc`(见 spec 11.2),不是 `created_at desc`。
- 所有写操作顺手写一条 `pool_events`,大盘靠它,不靠事后反推。

## 验收

- SQL 在 Supabase SQL Editor 里一次跑通,无报错。
- 用 anon key 直接 `select * from invite_codes` **应当失败**(权限拒绝)。这是验收的关键一条。
- 用 anon key 调 `pool_summary()` **应当成功**。
- 并发测试: 对同一个 `code_id` 并发调 `claim_code` 两次,只有一次成功。

## 不做什么

- 不写前端代码。
- 不做定时任务清理过期码(spec D6: 查询层过滤即可)。
- 不写业务逻辑之外的存储过程。
