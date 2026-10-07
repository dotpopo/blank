# AGENTS.md

本文件是**项目对新会话的常驻简报**。任何一次会话开始时先读它,再读它指向的 spec。

## 这个项目是什么

一个匿名的邀请码共享池。任何人把富余的邀请码丢进去,任何人一键取走一个。
没有账号,没有登录。前台只暴露池子总数与最新可领条目。

**完整的「要建什么」在 `docs/spec/invite-pool.spec.md`。先读它。**
单次会话的工作范围由 `docs/spec/tickets/` 下的工单界定,一次只做一张。

## 当前状态

- 分支: `feat/invite-pool`
- spec **已冻结**。决策台账见 `docs/spec/invite-pool.spec.md` 第 10 节(10.1 已拍板 **11** 条)。
- **T00 到 T11 全部落地。** 首页 / 贡献 / 大盘 / 管理后台四个页面都能用。
- **已经接上真实数据库**。`0001_init.sql` 与 `0002_align_decisions.sql` 都已执行,
  开发填充数据在 `supabase/seed-demo.sql`。
- 数据访问收敛在 `src/data/` 一个接缝: 环境变量齐就挂 Supabase 适配器,
  缺就退回演示适配器并在页头挂标记。**退回不是假装成功**, 页脚会写明当前数据源。
- **管理员账号由用户自己建**(`supabase/seed-admin.sql`), 仓库里不放任何凭据。
- e2e: `NODE_OPTIONS="" npx e2e run` → 18 个用例。后台完整流程走 `tools/verify-admin.cjs`。
  为什么分开, 见 `docs/spec/testing.md`。
- 已知待办(不在 T00 到 T11 范围内): 后台的「改已通过分类的有效期」缺一个 RPC;
  两个 `VITE_` 前缀的密钥建议改名去掉前缀。

## 设计读法与三个旋钮

**设计读法**: 读作一个工具型 Web 产品, 面向普通互联网用户(匿名、无账号、大概率从手机点进来),
调性是克制、可信、以数字为主角, 不写营销腔, 视觉体系走 Tailwind 工具类加自定义令牌, 不引入重型设计系统。

| 旋钮 | 取值 | 理由 |
|---|---|---|
| `DESIGN_VARIANCE` | **4** | 工具型产品, 信息优先。需要一点偏移(左对齐而非居中大标题)避免死板, 但不需要 artsy chaos |
| `MOTION_INTENSITY` | **4** | 动效只服务两个时刻: 领取成功、水位数字变化。不做叙事型滚动 |
| `VISUAL_DENSITY` | **5** | 水位数字是主角, 20 条可领列表要比营销页密, 但远不到 cockpit |

**设计概念(用户授权由我定, 原话「你自己构思设计啊」): 「纸与水的分界」。**
上面是纸(暖白), 下面是水(深松墨青)。水位数字不是贴在页面上的文字, 它是那条水线上的读数。

- **纸**: 暖白带旧纸的黄。冷灰是默认 SaaS 模板的样子, 不要回去
- **水**: 深松墨青, 全站唯一强调色。不是 Tailwind 蓝, 也不是参考页那个亮森林绿
- **暗色也是暖的**, 不是纯黑。冷黑会让整站失去纸感
- 大数字用衬线(Georgia 系), **中文标题不给衬线**(Windows 会掉到宋体, 大字很旧)
- **令牌名一个不改, 只改值**, 所以换肤就是改 `src/styles/tokens.css` 一个文件

**不要再问配色方向, 也不要自行换成别的方向。**

**技能适用范围**: `design-taste-frontend` 是为 landing page / portfolio 写的。
它明确把自己排除在 dashboard / 密集产品 UI 之外(该技能第 13 节)。
所以本项目的适用范围是:

- **首页、关于页**: 完整适用, 反 AI 味预检逐项过。
- **大盘 `/dashboard`、后台 `/admin`**: 属于密集产品 UI, 只借它的排版、色彩、状态原语纪律,
  不套它的营销版式(不做 hero、不做特性卡、不做滚动叙事)。

## 工作流技能

项目级技能装在 `../.workbuddy-ai/skills/`(工作区根目录下, 不在本仓库内),
来自 [mattpocock/skills](https://github.com/mattpocock/skills), MIT。
来源、范围、未装清单与安全审计结论见该目录的 `_UPSTREAM.md`。

装了什么、什么时候用:

| 技能 | 用在哪一步 |
|---|---|
| `to-spec` / `to-tickets` | 有新需求时,先把对话综合成 spec,再拆成曳光弹工单 |
| `grilling` | 设计还有没定的分支时,按轮次拷问,一轮问完整个前沿 |
| `domain-modeling` | 术语定下来时,内联更新 `GLOSSARY.md` 与 ADR |
| `codebase-design` | 定模块接口、找接缝、判断深浅时的词汇表 |
| `tdd` | 写测试与实现时,红绿循环,垂直切片,只在约定接缝上测 |
| `implement` | 按工单实现,接缝处驱动 `tdd`,收尾调 `code-review` |
| `code-review` | 每张工单收尾,双轴审查 diff(规范 + spec 忠实度) |
| `diagnosing-bugs` | 遇到难 bug,先造出能变红的反馈回路再动手 |
| `prototype` | 设计问题拿不准时,做一次性原型回答它 |
| `wizard` | 需要人类去第三方后台拿凭据时,生成交互式向导 |
| `handoff` | 会话太长要交接给下一个 agent 时 |

**两条与本项目约定冲突的地方,以本项目为准:**

1. `implement` 正文要求「Commit your work to the current branch」。
   本项目**提交前先说明**,不自动提交。
2. `to-tickets` 默认落盘到 `.scratch/<feature>/issues/`。
   本项目落在 `docs/spec/tickets/`。

## 硬性约定

1. **只做被要求的事。** 不加「顺手优化」,不擅自扩大工单范围。
   发现缺陷 → 记下来,单独开工单,不要在别的文件里顺手打补丁。
2. **前端不许千篇一律。** 动手写第一行 CSS 前,先写「设计读法」一行,
   并显式设定 `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` 三个旋钮。
   交付前跑完反 AI 味预检(见 `docs/spec/tickets/T11-quality.md`)。
3. **破折号零容忍**: U+2014 长破折号、U+2013 短破折号, 以及中文里连着写两个的那种,
   面向用户的文字里一律不许出现。用句号、逗号、冒号断句。
4. **不用假数据。** 禁止 `99.99%`、`John Doe`、`Acme`、`Elevate`、`Seamless`、`Unleash`;
   禁止 div 拼的假截图;禁止手搓 SVG 图标(用模板自带的 `lucide-react`)。
5. **前端不直接碰数据源。** 所有数据访问经由 `src/data/` 的接缝(接口 + 适配器)。
   当前阶段只有演示适配器;接真实库时新增 Supabase 适配器,页面代码不动。
   配额、去重、过期过滤这些规则**必须在演示适配器里真实现**,不能因为是演示数据就跳过。
6. **领取必须是原子的。** 真实适配器里由 Postgres 的 `for update skip locked` 保证,
   不在应用层做「先查后写」。演示适配器里用单线程同步临界区模拟同样的语义。
7. **验证产物,不看退出码。** 构建/测试通过与否,用实际读到的结构或数字下结论。

## 环境

| 项 | 值 |
|---|---|
| 技术栈 | React 18 + TypeScript + Vite 7 + Tailwind 3 + Supabase |
| 包管理 | npm |
| 开发服务器 | `npm run dev`,绑定 `127.0.0.1:5173` |
| 构建 | `npm run build` |
| e2e 测试 | `npm run test:e2e`(tester.army/e2e) |

### 环境变量与 PATH(2026-10-07 实测)

| 变量 | 在哪 | 实测状态 |
|---|---|---|
| `VITE_SUPABASE_URL` | 用户级环境变量(User) | `https://vsspvkeoukzbqwxbabbc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 用户级环境变量(User) | 208 字符的合法 anon JWT,`ref` 与 URL 一致,2036 年过期 |
| `LLM_BASE_URL` / `LLM_KEY` / `LLM_MODEL_ID` | 用户级环境变量(User) | e2e 的模型凭证,`e2e.config.ts` 直接读 `process.env` |

**不要写 `.env` 文件**。这三个 Supabase 变量和三个 LLM 变量都以用户级环境变量为唯一来源。

**两条坑,都是 WorkBuddy 运行时的行为,不是用户配置错了:**

1. **子进程里的 `node` 不是 `D:\nodejs` 的。** WorkBuddy 会在每个子 shell 的 PATH 最前面插入
   托管运行时(`.../binaries/node/versions/22.22.2-2`)。用户 PATH 里 `D:\nodejs`
   (Machine 段第 16 位,`D:\nodejs\node.exe` 是 24.16.0)在前移之后**仍然会被托管版本盖住**。
   所以 e2e 那条 `export PATH="/d/nodejs:$PATH"` **还是要留着**。
2. **应用进程的环境变量是启动时快照。** 用户在应用启动之后新加的环境变量,
   子 shell 里读不到(`env | grep VITE_` 为空)。要让子进程拿到,得**重启 WorkBuddy**。
   在重启之前,需要这些值时直接从注册表读:
   `[Environment]::GetEnvironmentVariable('VITE_SUPABASE_URL','User')`。

**Supabase 连通性的正确探法**(别用 `/rest/v1/` 根路径,那个要 service_role,会误报 401):

```bash
curl -sS -i -H "apikey: $KEY" "$URL/auth/v1/health"        # 期望 200 + GoTrue 版本
curl -sS -i -H "apikey: $KEY" "$URL/rest/v1/apps?select=id&limit=1"
# 期望 404 + PGRST205(表不存在)= 鉴权已通过;真 401 才是 key 无效
```

本机 DNS 对 `*.supabase.co` / `*.supabase.com` 解析到 `198.18.x.x`
(代理工具的 fake-IP 段),请求能正常穿过去,不用管。

### 跑 e2e 前必须注意

完整说明见 `docs/spec/testing.md`。三条硬性的:

- e2e 要求 **Node ≥ 22.22.3 / 24.8**。本机 PATH 默认解析到 `22.22.2`,**不够**。
  先把 `D:\nodejs`(Node 24.16.0)放到 PATH 最前。
- **必须加 `NODE_OPTIONS=""`**。沙箱注入的删除守卫会让 e2e 清 `.e2e/artifacts` 时失败,
  报成 `[safe-delete] ... trash operation`,看起来像测试挂了,其实跟测试无关。

  ```bash
  export PATH="/d/nodejs:$PATH"
  NODE_OPTIONS="" npx e2e run
  ```

- 模型凭证来自**用户级环境变量** `LLM_BASE_URL` / `LLM_KEY` / `LLM_MODEL_ID`。
  `e2e.config.ts` 直接读 `process.env`,**不要**再写 `export`,也不要把密钥写进任何文件。
- 实测该网关支持 function calling(`finish_reason: tool_calls`)。
  图片输入能力未验证,若 agent 步骤报错,先怀疑这一项。
- **不要用 `executable: 'npm'` 起开发服务器**,Windows 上会 `spawn EINVAL`。
  用 `process.execPath` 跑 `node_modules/vite/bin/vite.js`(已在配置里)。

### 安全

- `.env` 已在 `.gitignore` 里,**永远不要提交**。
- 管理员密码只以 bcrypt 哈希形式存在于数据库。仓库里不放任何明文密码。
- `tools/password-hash.html` 是本地工具,不联网、不发请求。

## 记忆

- 本项目的长期约定写进本文件与 `docs/spec/`。
- 跨项目的用户偏好写在 `~/.workbuddy-ai/MEMORY.md`。
