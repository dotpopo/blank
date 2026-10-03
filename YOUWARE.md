# YOUWARE 空白网站项目

这是一个完全空白的 React + TypeScript + Vite + Tailwind CSS 项目。

## 当前状态

- **页面内容**: 无。`src/App.tsx` 直接返回 `null`，页面上不会渲染任何元素或文字。
- **技术栈**: React 18 + TypeScript + Vite 7 + Tailwind CSS 3（配置保留，便于后续扩展）
- **入口**: `src/main.tsx`

## Supabase 数据库接入（已完成）

- **客户端**: `@supabase/supabase-js` 已安装，客户端在 `src/lib/supabase.ts` 导出 `supabase` 实例
- **环境变量**: `.env` 中配置了 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`（项目 ref: `vsspvkeoukzbqwxbabbc`），`.env.example` 留有模板
- **连接状态**: 已验证，anon key 有效，可正常访问该项目的 PostgREST/GoTrue 服务
- **使用方式**: 在组件中 `import { supabase } from "@/lib/supabase"`（或相对路径），即可做增删改查和认证

## Git / GitHub

- **远程仓库**: `git@github.com:dotpopo/blank.git`（SSH 方式）
- **默认分支**: `main`
- **认证**: 沙箱内 SSH 密钥（`~/.ssh/id_ed25519`），公钥已添加到 GitHub 账号
- **注意**: `.gitignore` 已排除 `node_modules/`、`dist/`、`.env`；`.env.example` 已提交
- **沙箱注意**: git 操作需 `git config --global --add safe.directory /workspace`（已完成）

## 后续开发说明

- 页面结构从 `src/App.tsx` 开始添加组件。
- 可复用组件放 `src/components/`，页面放 `src/pages/`，状态管理放 `src/store/`。
- 数据库表需先在 Supabase Dashboard → SQL Editor 中创建，anon key 无建表权限。
- 构建命令：`npm run build`

## 邀请码共享池（分支：`feat/invite-share-pool`）

已实现「开门 OpenDoor」邀请码共享站点与审核能力：

- **首页** `/`：搜索、分类筛选、邀请卡片、详情领取弹窗、分享提交弹窗（移植自原型 index.html）。
- **审核台** `/admin`：待审/需修改/已通过/已驳回队列，支持通过、退回修改、驳回（退回/驳回必填原因）。
- **数据层** `src/api/invites.ts`：配置了 Supabase 走数据库，未配置则回退 localStorage（当前为本地演示模式）。
- **后端方案** `supabase/migrations/0001_moderation.sql`：表结构 + 状态机 + 去重索引 + 审计触发器 + 原子领取 RPC + RLS。
- **设计文档** `docs/moderation-design.md`：审核分层架构、风险、RLS 清单、分阶段落地、待拍板决策点。
- **别名**：已配置 `@/` → `src/`（vite + tsconfig）。

上手：`npm install` → `npm run dev`。要接真实后端，请在 `.env` 填写 Supabase 凭据并在 Dashboard 执行迁移脚本。
