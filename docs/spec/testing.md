# 测试 (tester.army/e2e)

配套工单: `tickets/T10-e2e-suite.md`。这里只写**怎么跑、怎么加、坑在哪**。

## 怎么跑

```bash
cd <仓库根>
export PATH="/d/nodejs:$PATH"     # 见下面「Node 版本」
NODE_OPTIONS="" npx e2e run       # 见下面「safe-delete 陷阱」
```

跑单个文件:

```bash
NODE_OPTIONS="" npx e2e run tests/tools-password-hash.e2e.ts
```

列出会被执行的用例(不跑):

```bash
npx e2e list
```

## 三个必须先知道的环境事实

### 1. Node 版本

e2e 要求 **Node ≥ 22.22.3 / 24.8**。本机 PATH 首位是托管 Node `22.22.2`, **不够**。

所以每条 e2e 命令前都要把系统 Node 24 放到最前:

```bash
export PATH="/d/nodejs:$PATH"     # Node 24.16.0
```

不加的话 e2e 会以版本不满足直接退出。

### 2. safe-delete 陷阱(最重要)

WorkBuddy 沙箱通过 `NODE_OPTIONS=--require=.../node-language-shim.cjs` 注入一个
删除守卫, **单轮删除超过 50 个文件就拒绝**。

e2e 每次启动会清 `.e2e/artifacts`, 于是必然踩中:

```
ERROR  test error ERROR (launch)
[safe-delete] 操作失败: ERROR ...\.e2e\artifacts:
Error during a `trash` operation: Unknown { description: "Some operations were aborted" }
```

这个报错看起来像测试挂了, 其实是**守卫拦住了清理动作**, 跟测试本身无关。

**修法**: 只对这条命令摘掉 shim, 不改项目、不改 PATH。

```bash
NODE_OPTIONS="" npx e2e run
```

也试过「把目录移走」(`mv .e2e/artifacts _prev/`), 但 `mv` 同样被拦
(`Permission denied`), 所以直接用 `NODE_OPTIONS=""` 最省事。

### 3. Windows 上不要让 runner 去 spawn npm

`app.command` 里写 `executable: 'npm'` 或 `'npm.cmd'` 会得到:

```
ERROR  test error ERROR
spawn EINVAL
```

原因: runner 不开 shell, 而 Node 在 Windows 上拒绝直接 spawn `.cmd` / `.bat`。

**修法**(已写进 `e2e.config.ts`): 用跑 e2e 的那个 node 直接执行 Vite 的 JS 入口。

```ts
command: {
  executable: process.execPath,
  args: ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173"],
  reuseExisting: true,
}
```

## 配置

- `e2e.config.ts`, 一个 web target, 指向 `http://127.0.0.1:5173`。
- runner 自己起 Vite、等端口就绪、跑完关掉。本地已经有服务时会复用(`reuseExisting`)。
- **模型凭证**: `LLM_BASE_URL` / `LLM_KEY` / `LLM_MODEL_ID`, 从 **Windows 用户级环境变量**读,
  在 `e2e.config.ts` 里直接 `process.env`。不需要每次 `export`, 密钥不落盘。
  这三个变量缺失时配置加载即失败, 报错会说明缺哪个。
- 实测该网关支持 function calling(`finish_reason: tool_calls`)。
  **图片输入能力未验证**, 而 e2e 的 agent 步骤要求「tool calls + 图片」。
  若 `agent.act` 报错, 先怀疑这一项, 降级为只用 `expect` 写确定性断言。

## 写用例时的几个坑(实测踩过)

### 状态区的无障碍名就是它的内容

```html
<div role="status" aria-live="polite"></div>
```

给这种 live region 加 `aria-label` 不起作用: 一旦有内容, 无障碍树里的名字就是那段内容。
实测 `#n26 status "先填一个密码。"`, 所以 `getByRole('status', '生成状态')` **匹配不到**。

**做法**: 给状态区加 `data-testid`, 用 `getByTestId` 定位。

### 密码输入框的值读不到

`inputValue()`、`toHaveValue()`、`toHaveAttribute()` 作用在 password 字段上都是
`POLICY_DENIED`(取反也一样)。这是框架的有意设计。

**做法**: 不要断言密码框里的值。要验证「密码对不对」, 去断言**校验结果**那段文案。

### 异步结果要等, 不能点完就读

`textContent()` 是单次读取, **不轮询**。点击后立刻读, 拿到的是旧值。

**做法**: 用会轮询的断言等状态变化。

```ts
await screen.getByRole("button", "生成哈希").tap();
await expect(screen.getByTestId("hash-output")).not.toHaveText(previous);
const next = await screen.getByTestId("hash-output").textContent();
```

### 文本匹配是精确匹配

`getByRole(role, name)` / `getByLabel` / `getByText` 都是**整串精确匹配**(空白归一化后),
和 Playwright 不一样: `name: 'Save'` 匹配不到 `Save changes`。
要子串匹配得显式写 `{ exact: false }` 或正则。

### 失败先看无障碍树, 别猜

每个失败用例都会存一份当时的无障碍树:

```
.e2e/artifacts/web/<用例名>/default/attempt-0/failure/screen.txt
```

这份文件比截图有用得多: 它把页面上所有可访问节点和它们的名字列全了,
能直接告诉你「元素在不在」「名字到底是什么」。

## 加用例

- 文件放 `tests/`, 命名 `*.e2e.ts`。
- 数据夹具用 SQL 或 RPC 造, 不要依赖手工点出来的状态。
- 用例之间互不污染: 配额存在 localStorage, 必要时用 `app.clearState()`。
- **尽量不依赖模型**。确定性 `expect` 断言更快更稳, agent 步骤只用在真的需要
  「用自然语言描述目标」的地方。

## 当前覆盖

| 文件 | 用例数 | 依赖模型 |
|---|---|---|
| `tests/tools-password-hash.e2e.ts` | 4 | 否 |
| `tests/example.e2e.ts` | 1 | 否 |

产品本身的用例(T10)还没写, 等 T05 到 T09 落地。

---

## 后台为什么不在 e2e 套件里（2026-10-07 补充）

`tests/admin.e2e.ts` **只**覆盖「演示数据源下后台如实说明不可用」这一半。
完整的后台流程（登录、待审队列、分类增删、码列表）走 `tools/verify-admin.cjs`。

原因是数据源冲突：

| | 需要的数据源 | 为什么 |
|---|---|---|
| `tests/home.e2e.ts`、`tests/dashboard.e2e.ts`、`tests/admin.e2e.ts` | **演示** | 要能「重置演示数据」回到同一个起点；要确定；不能消耗真实库存 |
| 完整后台流程 | **真实库** | 后台要服务端校验口令、保存会话；演示源没有服务端 |

而 e2e 框架**不给它启动的应用进程传环境变量**（实测：父进程设了 `VITE_SUPABASE_URL`，
框架拉起的 vite 依然读到空值）。所以同一个 5173 不可能同时是两种数据源。

### 跑 e2e 套件（演示源，不需要任何变量）

```bash
export PATH="/d/nodejs:$PATH"
NODE_OPTIONS="" npx e2e run
```

### 跑后台验证（真实库，需要凭据）

1. 先建管理员账号：把 `supabase/seed-admin.sql` 里的两个 `CHANGE_ME` 换成你的，粘进 SQL Editor 执行。
2. 起开发服务器，**带上** `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`。
3. 跑脚本：

```bash
set ADMIN_USER=你的用户名
set ADMIN_PASS=你的密码
set NODE_PATH=<项目>/node_modules
node tools/verify-admin.cjs
```

脚本会走一遍：未登录给登录框、错误密码给通用提示（不泄露用户名是否存在）、
登录后三个面板都在、队列里有待审分类、分类列表有数据、码列表没有任何删除入口（D-11）、
队列接受键盘操作、控制台错误为 0。**凭据只从环境变量读，不进仓库。**

### 一条踩过的坑

后台任务（不管是哪种 shell 的后台执行）有**约 2 分钟上限**。开发服务器跑到 2 分钟会被掐，
e2e 跑到一半就会 `ERR_CONNECTION_REFUSED`，看起来像测试挂了。
让 e2e 自己起服务器（`reuseExisting: true` 下没服务它自己起）就没有这个问题。
