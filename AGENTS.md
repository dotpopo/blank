# AGENTS.md

本文件是**项目对新会话的常驻简报**。任何一次会话开始时先读它,再读它指向的 spec。

## 这个项目是什么

一个匿名的邀请码共享池。任何人把富余的邀请码丢进去,任何人一键取走一个。
没有账号,没有登录。前台只暴露池子总数与最新可领条目。

**完整的「要建什么」在 `docs/spec/invite-pool.spec.md`。先读它。**
单次会话的工作范围由 `docs/spec/tickets/` 下的工单界定,一次只做一张。

## 当前状态

- 分支: `feat/invite-pool`
- spec 已写好,**等用户回答「第 10 节 开放问题」后冻结**
- **尚未开始功能开发**。下一步是 T00(基线),然后 T01(数据模型)。
- 模板自带的 `src/App.tsx` 仍然 `return null`,这是正常的。

## 硬性约定

1. **只做被要求的事。** 不加「顺手优化」,不擅自扩大工单范围。
   发现缺陷 → 记下来,单独开工单,不要在别的文件里顺手打补丁。
2. **前端不许千篇一律。** 动手写第一行 CSS 前,先写「设计读法」一行,
   并显式设定 `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` 三个旋钮。
   交付前跑完反 AI 味预检(见 `docs/spec/tickets/T11-quality.md`)。
3. **破折号 `—` / `–` 零容忍**(中文 `——` 同样算)。用句号、逗号、冒号断句。
4. **不用假数据。** 禁止 `99.99%`、`John Doe`、`Acme`、`Elevate`、`Seamless`、`Unleash`;
   禁止 div 拼的假截图;禁止手搓 SVG 图标(用模板自带的 `lucide-react`)。
5. **前端不直接碰数据库表。** 所有数据访问经由 `src/api/`(T03)。
   表上开了 RLS 且不给 anon 任何直接权限,直接查会失败,这是设计而不是故障。
6. **领取必须是原子的**,在 Postgres 侧用 `for update skip locked` 保证,
   不要在应用层做「先查后写」。
7. **验证产物,不看退出码。** 构建/测试通过与否,用实际读到的结构或数字下结论。

## 环境

| 项 | 值 |
|---|---|
| 技术栈 | React 18 + TypeScript + Vite 7 + Tailwind 3 + Supabase |
| 包管理 | npm |
| 开发服务器 | `npm run dev`,绑定 `127.0.0.1:5173` |
| 构建 | `npm run build` |
| e2e 测试 | `npm run test:e2e`(tester.army/e2e) |

### 跑 e2e 前必须注意

- e2e 要求 **Node ≥ 22.22.3 / 24.8**。本机 PATH 默认解析到 `22.22.2`,**不够**。
  先把 `D:\nodejs`(Node 24.16.0)放到 PATH 最前。
- 模型凭证来自**用户级环境变量** `LLM_BASE_URL` / `LLM_KEY` / `LLM_MODEL_ID`。
  `e2e.config.ts` 直接读 `process.env`,**不要**再写 `export`,也不要把密钥写进任何文件。
- 实测该网关支持 function calling(`finish_reason: tool_calls`)。
  图片输入能力未验证,若 agent 步骤报错,先怀疑这一项。

### 安全

- `.env` 已在 `.gitignore` 里,**永远不要提交**。
- 管理员密码只以 bcrypt 哈希形式存在于数据库。仓库里不放任何明文密码。
- `tools/password-hash.html` 是本地工具,不联网、不发请求。

## 记忆

- 本项目的长期约定写进本文件与 `docs/spec/`。
- 跨项目的用户偏好写在 `~/.workbuddy-ai/MEMORY.md`。
