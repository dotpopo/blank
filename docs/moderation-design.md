# 邀请码共享池 —— 审核（Moderation）功能设计

> 面向「开门 OpenDoor」邀请码共享池。回答一个问题：**审核到底该怎么做才既安全又不累？**
> 配套实现：`supabase/migrations/0001_moderation.sql`（表 / RLS / 触发器 / 原子领取）。

---

## 0. 结论速览

推荐 **「自动预检 + 人工复核 + 用户举报熔断」** 三段式，分层落地：

| 层 | 职责 | 不可替代的原因 |
| --- | --- | --- |
| 前端（React） | 表单校验、即时提示、链接清洗预览 | 只优化体验，**不作为安全边界** |
| Edge Function | 清洗追踪参数、域名白名单、敏感词、链接可达性、验证码、去重 | 访问网络、持服务端密钥 |
| Postgres（RLS + 触发器 + RPC） | 状态机、可见性隔离、原子领取、审计 | **唯一可信的强制层** |

一句话：**前端可以骗，Edge Function 可以绕过（直接打 PostgREST），只有数据库约束和 RLS 骗不了。**
所以「谁能看到什么、能不能改状态」必须写在数据库里。

---

## 1. 为什么邀请码类站点审核特别难

除了通用的垃圾内容，邀请码有 5 个特有风险：

1. **钓鱼 / 仿冒**：提交指向仿冒登录页的链接，或带 Affiliate 参数劫持收益。
2. **隐私泄露**：部分产品的邀请链接里直接带推荐人邮箱/手机号（`?ref=user@example.com`）。
3. **一码多用 / 死码**：一次性码被多人领，或失效链接长期挂着消耗信任。
4. **爬虫批量领取**：脚本秒级扫光共享池，再去转卖。
5. **重复灌水**：同一码换 query 参数反复提交，霸屏审核队列。

对应到设计：**去重靠 code_hash，安全靠域名白名单，隐私靠参数清洗，防刷靠限流+验证码，防一码多用靠原子的 claim RPC。**

---

## 2. 审核状态机

6 个状态，全部落在 `invite_codes.status`：

| 状态 | 含义 | 前台可见 | 谁可见 |
| --- | --- | --- | --- |
| `pending` | 待审核 | ❌ | 作者 + 审核员 |
| `approved` | 已通过 | ✅ | 所有人 |
| `needs_changes` | 退回修改 | ❌ | 作者 + 审核员 |
| `rejected` | 已驳回 | ❌ | 作者（含原因）+ 审核员 |
| `exhausted` | 已领完 / 失效 | 打标或隐藏 | 所有人 |
| `expired` | 已过期 | ❌ | 所有人 |

### 迁移表

| 从 | 到 | 触发方 | 条件 |
| --- | --- | --- | --- |
| （新建） | `pending` | 用户 | 提交 |
| （新建） | `rejected` | 系统 | 命中黑名单 / 敏感词 / 去重冲突（可选自动驳回） |
| `pending` | `approved` | 审核员 | 人工通过 |
| `pending` | `rejected` | 审核员 | 无效 / 钓鱼 / 重复，**必须填原因** |
| `pending` | `needs_changes` | 审核员 | 信息不全 / 选错产品，**必须填说明** |
| `needs_changes` | `pending` | 作者 | 编辑后重新排队 |
| `approved` | `exhausted` | 系统 | 领完，或失效举报达阈值自动熔断 |
| `approved` | `expired` | 定时任务 | 超过 `expires_at` |
| `approved` | `rejected` | 审核员 | 事后举报核实，强制下架 |

> 关键约束：**作者永远不能把状态改成 `approved`**。RLS 的 `WITH CHECK` 强制作者提交/修改后状态只能是 `pending`。

---

## 3. 分层审核流程

```
[前端]  ──格式校验、清洗预览、即时提示──▶  (体验层，不可信)
   │
   ▼
[Edge Function /submit-invite]  ── 参数清洗、域名白名单、敏感词、链接可达性、Turnstile 验证、code_hash 去重
   │
   ▼
[Postgres]  ── RLS 可见性隔离 · 唯一索引去重 · 触发器写审计 · claim_code() 原子领取
```

**自动预检（决定进入哪种队列）**

| 检查 | 结果 |
| --- | --- |
| 格式非法 / 链接不可达 | → `needs_changes`（退回） |
| 命中黑名单 / 敏感词 / 钓鱼域名 | → `rejected`（直接驳回） |
| `code_hash` 与现有待审/已通过重复 | → `rejected`（重复提交） |
| 域名白名单不符但非黑名单 | → `pending` + 打「重点核查」标记 |
| 通过全部预检 | → `pending`（人工复核） |

**人工复核**：审核台按状态过滤，通过 / 退回 / 驳回（驳回与退回必填原因）。
**申诉**：作者在 `needs_changes` 可改后重提；对 `rejected` 有异议可走 `code_reports` 或客服。

---

## 4. 数据模型

| 表 | 用途 | 关键字段 |
| --- | --- | --- |
| `profiles` | 用户与角色 | `id`, `role`, `reputation_score`, `is_banned` |
| `products` | 产品字典 | `name`, `category`, `domain_whitelist[]`, `is_active` |
| `invite_codes` | 邀请码主体 / 审核队列 | `status`, `code_type`, `code_hash`, `display_code`, `secret_code`, `max_claims`, `current_claims`, `expires_at`, `review_note` |
| `code_claims` | 领取流水 | `code_id`, `user_id`, `visitor_hash`, `claimed_at` |
| `code_reports` | 举报 | `code_id`, `reporter_id`, `reason`, `status` |
| `moderation_logs` | 审计日志 | `action`, `from_status`, `to_status`, `reason`, `operator_id` |

**关键索引/约束**

```sql
-- 同一产品下，待审/已通过的相同内容只允许一条（去重）
create unique index uniq_active_code
  on public.invite_codes (product_id, code_hash)
  where status in ('pending','approved') and code_hash is not null;

-- 首页信息流
create index idx_invite_feed
  on public.invite_codes (status, category, submitted_at desc);

-- 领取限流
create index idx_claims_rate
  on public.code_claims (visitor_hash, claimed_at desc);
```

---

## 5. RLS 策略清单（安全核心）

前提：启用 RLS，且**不把 `service_role` 暴露给前端**。下表动作均指 `anon` / `authenticated` 通过 PostgREST 的直连操作。

| 表 | 角色 | 动作 | 条件（USING / WITH CHECK） |
| --- | --- | --- | --- |
| `invite_codes` | anon, authenticated | SELECT | `status = 'approved'` |
| `invite_codes` | authenticated（作者） | SELECT | `auth.uid() = user_id` |
| `invite_codes` | moderator/admin | SELECT | `is_moderator()` |
| `invite_codes` | authenticated | INSERT | `auth.uid() = user_id AND status = 'pending'` |
| `invite_codes` | authenticated（作者） | UPDATE | USING `status='needs_changes'` → CHECK `status='pending'` |
| `invite_codes` | moderator/admin | UPDATE / DELETE | `is_moderator()` |
| `code_claims` | authenticated | SELECT | 本人或 `is_moderator()`；**不允许直接 INSERT**（由 RPC 写） |
| `code_reports` | authenticated | INSERT / SELECT | `auth.uid() = reporter_id`（+ 审核员可读全部） |
| `moderation_logs` | moderator/admin | SELECT | `is_moderator()`；**无 INSERT 策略**（仅触发器写） |
| `products` | anon, authenticated | SELECT | `is_active`；写操作仅 `is_moderator()` |

`is_moderator()` 用 `SECURITY DEFINER` 实现，避免策略递归查 `profiles` 时的权限问题。

> 为什么这样写就安全：匿名用户拿 anon key 直接打 PostgREST，`UPDATE invite_codes SET status='approved'` 会被 RLS 拒绝（没有对应 policy）；`INSERT ... status='approved'` 会被 `WITH CHECK` 拒绝。

---

## 6. 领取端防护

1. **脱敏下发**：列表页只给 `display_code`（如 `ZX-****-A7K2`），真实码不进 DOM。
2. **原子领取**：点击领取 → 验证码（Turnstile）→ Edge Function → `claim_code()` RPC：
   - `SELECT ... FOR UPDATE` 行锁，避免并发超领；
   - 自增 `current_claims`，达到 `max_claims` 自动置 `exhausted`；
   - 单访客每小时限流（默认 10 次，见 `code_claims`）。
3. **失效熔断**：同一码在短时间内收到多个不同来源的「已失效」举报，自动置 `exhausted` 并生成复检工单。
4. **反爬**：验证码 + 限流 + 服务端签名；不用纯前端倒计时当防护。

---

## 7. 分阶段落地路线

**Phase 1 — 安全闭环（先把地基打对）**
- 执行 `0001_moderation.sql`，确保 RLS 生效；
- 前端接通真实提交 + 审核台（本仓库已实现 UI 与数据层）；
- 提交即 `pending`，审核员通过后才公开。

**Phase 2 — 反滥用**
- Edge Function 做清洗 / 白名单 / 可达性 / 去重；
- 接入验证码与 IP/设备限流；
- 举报与自动熔断。

**Phase 3 — 自动化与信誉**
- 高信誉作者免审直通；连续被举报自动降权/封禁；
- `pg_cron` 定时把过期码流转为 `expired` 并清理冷数据；
- 运营看板（通过率、平均审核时长、举报率）。

---

## 8. 需要你拍板的决策点

这几项会显著改变实现，建议先定：

1. **是否强制登录才能提交？** 允许匿名提交更繁荣但更难追责；建议「提交需登录，领取可匿名」。
2. **自动驳回 vs 全部人工**：MVP 建议只对「黑名单/明确重复」自动驳回，其余人工，避免误杀。
3. **`secret_code` 是否加密存储？** 当前 schema 为明文列；若要更强保护，可入 Supabase Vault，仅在 RPC 内解密下发。
4. **邀请码有效期**：是否需要作者填 `expires_at`、是否加 `pg_cron` 自动过期？
5. **一码一领 vs 多领**：默认按 `max_claims` 控制；一次性码设 `max_claims = 1`。

---

## 9. 本仓库当前实现状态

| 项 | 状态 |
| --- | --- |
| 首页（移植 index 原型） | ✅ 已实现 |
| 详情领取弹窗 + 脱敏/明文切换 | ✅ 已实现（本地模拟限流） |
| 分享提交弹窗 + 链接清洗/隐私提示 | ✅ 已实现 |
| 审核台（通过 / 退回 / 驳回 + 原因） | ✅ 已实现（本地模式，无鉴权） |
| 数据层：Supabase / localStorage 双通道 | ✅ 已实现 |
| 数据库 schema + RLS + 触发器 + 领取 RPC | ✅ 已提供 `0001_moderation.sql`（待你在 Dashboard 执行） |
| Edge Function（清洗/白名单/验证码/去重） | ⛔ 待开发（Phase 2） |
| 举报与自动熔断 | ⛔ 待开发（Phase 2） |
| 真实鉴权与审核员角色 | ⛔ 待接入 Supabase Auth（当前审核台无鉴权） |

> ⚠️ 当前前端为**本地演示模式**（`.env` 未配置 Supabase）：提交/审核写入 localStorage，方便先看交互。
> 配置 `.env` 中的 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 并执行迁移后即切换到数据库。
