# 水线 · 匿名邀请码共享池

一口公开的池子。任何人把富余的邀请码丢进去，任何人一键取走一个。
没有账号，没有登录，不记录你是谁。前台只暴露池子总数与最新可领条目。

## 它想解决什么

邀请码这种东西，发的人找不到要的人，要的人找不到发的人。散在群里、私聊里、帖子底下，
过两天就过期了，谁也不知道浪费了多少。

所以这里不做「商城」，做「水位计」：只报池子里还剩多少，让供需是否失衡一眼可见。

## 设计概念

**纸与水的分界。** 上面是纸（空气），下面是水（池子）。水位数字不是贴在页面上的文字，
它是那条水线上的读数。配色、版式、动效都从这个概念里长出来：

- **纸**：暖白，带一点旧纸的黄
- **水**：深松墨青，全站唯一的强调色
- **水带**：页面里那条水面的高度是**真实数据**，当前水位在过去 30 天区间里的位置
- **数字会走**：水位从 43 掉到 42 时是滚过去的，不是换字
- **手感**：领取时落一滴水、荡一圈涟漪、码文逐字浮出来；摇骰子时骰子真的转

设计读法与三个旋钮（`DESIGN_VARIANCE 4` / `MOTION_INTENSITY 4` / `VISUAL_DENSITY 5`）
写在 `AGENTS.md` 里。

## 技术栈

React 18 + TypeScript + Vite 7 + Tailwind 3 + Supabase（Postgres + RLS + RPC）
+ framer-motion + zod + lucide-react。没有引入图表库，趋势图是手写的 SVG。

## 跑起来

### 1. 环境变量（用户级，不要写进 `.env`）

| 变量 | 用途 |
|---|---|
| `VITE_SUPABASE_URL` | Supabase 项目地址 |
| `VITE_SUPABASE_ANON_KEY` | 公开的 anon key |
| `LLM_BASE_URL` / `LLM_KEY` / `LLM_MODEL_ID` | e2e 的模型凭证 |

两个 `VITE_` 变量缺任意一个，应用会**退回演示数据源**并在页头挂标记。
退回不是假装成功：页脚会写明当前数据源。所以本地没配也能跑，只是数据在浏览器里。

### 2. 建库

```bash
# 把这两个文件按顺序粘进 Supabase Dashboard -> SQL Editor 执行
supabase/migrations/0001_init.sql             # 表、索引、RPC、权限
supabase/migrations/0002_align_decisions.sql  # 对齐决策台账
supabase/migrations/0003_admin_set_app_validity.sql  # 改已通过分类的有效期
supabase/migrations/0004_admin_events.sql            # 后台的操作日志

# 开发用的填充数据，只在空库上跑，幂等
supabase/seed-demo.sql
```

清掉演示数据：

```sql
truncate public.pool_events, public.invite_codes, public.apps restart identity cascade;
```

### 3. 建管理员账号

管理员是固定账号，不开放注册。用户名和密码由你自己定：

```sql
-- 把两个 CHANGE_ME 换成你的，粘进 SQL Editor 执行
insert into public.admins (username, password_hash)
values ('CHANGE_ME_USERNAME',
        extensions.crypt('CHANGE_ME_PASSWORD', extensions.gen_salt('bf', 12)))
on conflict (username) do update set password_hash = excluded.password_hash;
```

也可以离线生成：打开 `tools/password-hash.html`，把生成的哈希填进去。
口令在库里只以 bcrypt 哈希存在，明文不落在任何文件里。

### 4. 开发与构建

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build
```

## 测试

```bash
export PATH="/d/nodejs:$PATH"   # e2e 要求 Node >= 22.22.3
NODE_OPTIONS="" npx e2e run
```

18 个用例，全部是确定性断言，**不需要模型**。覆盖领取、额度、去重、贡献、大盘、后台降级。

管理后台的完整流程走独立脚本（需要真实库与管理员凭据）：

```bash
set ADMIN_USER=你的用户名
set ADMIN_PASS=你的密码
node tools/verify-admin.cjs
```

为什么后台不在 e2e 套件里、以及每个用例在测什么，见 `docs/spec/testing.md`。

## 目录

```
src/
  data/        数据接缝。页面只认这里的接口，不认底下是演示数据还是 Supabase
    seam.ts          接口与领域错误
    demo-source.ts   演示适配器（规则与 SQL 一一对应，不是占位）
    supabase-source.ts  真实库适配器，SQL 与领域模型的命名差异集中在这里映射
    quota.ts         配额与浏览器标识（浏览器本地的事，两个适配器共用）
    admin.ts         管理后台的数据接缝
  components/  基础控件、水面、会走的数字
  layouts/     外壳
  pages/       首页 / 贡献 / 大盘 / 后台
  styles/      设计令牌
supabase/      迁移与填充数据
tools/         密码生成器、后台验证脚本
docs/spec/     规格书与工单，先读 invite-pool.spec.md
```

## 几条不能破的约定

1. **单一强调色。** 全站只有「水」这一族颜色，不做第二个强调色。
2. **令牌名不改，只改值。** 换肤就是改 `src/styles/tokens.css` 一个文件。
3. **数据访问只经接缝。** 页面不直接碰 Supabase。
4. **先检查额度，再打服务端。** 反过来的话额度超限时服务端已经把码发出去了，用户白丢一个码。
5. **数据薄的时候要说数据薄。** 少于 3 天有记录就不画趋势，而不是画一条看着很可信的假曲线。
6. **管理员不删邀请码**（决策 D-11），只做分类增删与审批。

完整的决策台账（11 条已拍板）在 `docs/spec/invite-pool.spec.md` 第 10 节。
