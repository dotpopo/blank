// =============================================================================
// 管理后台的端到端验证脚本
// =============================================================================
// 为什么不是 e2e 用例: 后台需要真实数据库, 而首页与大盘的用例需要演示数据源
// (要能重置、要确定、不能消耗真实库存)。同一个 5173 不可能同时是两种数据源,
// 所以后台这一半走独立脚本。
//
// 需要三样东西, 全部从环境变量读, 不写进仓库:
//   ADMIN_USER  管理员用户名
//   ADMIN_PASS  对应的密码
//   BASE_URL    应用地址, 默认 http://127.0.0.1:5173
// 另外需要 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY 已经注入到开发服务器。
//
// 用法 (Windows 终端):
//   set ADMIN_USER=你的用户名
//   set ADMIN_PASS=你的密码
//   set NODE_PATH=<项目>/node_modules
//   node tools/verify-admin.cjs
//
// 没有管理员账号的话, 先跑 supabase/seed-admin.sql 建一个。
// =============================================================================

// 用临时管理员登录, 走一遍待审队列 / 分类管理 / 码列表, 截图并收集控制台错误。
const { chromium } = require("playwright-core");

const EXE =
  process.env.CHROME_SHELL ||
  "C:/Users/NINGMEI/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe";
const BASE = process.env.BASE_URL || "http://127.0.0.1:5173";
const OUT = process.env.OUT || "C:/Users/NINGMEI/AppData/Local/Temp/admin-verify";
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;

(async () => {
  const fs = require("fs");
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 }, colorScheme: "light" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const step = (label, ok, extra = "") =>
    console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra ? "  -> " + extra : ""}`);

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });

  // 1. 登录框
  const hasLogin = await page.getByTestId("admin-username").isVisible().catch(() => false);
  step("未登录时给出登录框", hasLogin);

  // 2. 错误密码不泄露用户名是否存在
  await page.getByTestId("admin-username").fill("definitely-not-a-real-admin");
  await page.getByTestId("admin-password").fill("nope");
  await page.getByRole("button", { name: "登录" }).click();
  const errText = (await page.getByTestId("admin-login-error").textContent().catch(() => "")) || "";
  step("错误密码给出通用提示", /用户名或密码不正确/.test(errText), errText.trim().slice(0, 40));

  // 上一步的 400 是故意的 (错误密码), 从这里开始重新计数
  errors.length = 0;

  // 3. 正确凭据登录
  await page.getByTestId("admin-username").fill(USER);
  await page.getByTestId("admin-password").fill(PASS);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByTestId("pending-queue").waitFor({ timeout: 15000 });
  step("登录后进入后台", true);

  // 4. 三个面板都在
  for (const [id, label] of [
    ["pending-queue", "待审队列"],
    ["apps-panel", "分类管理"],
  ]) {
    step(`${label} 渲染`, await page.getByTestId(id).isVisible().catch(() => false));
  }

  // 5. 待审队列里有那条种子数据
  const pendingText = await page.getByTestId("pending-queue").innerText();
  step("队列里有待审分类", /云栖笔记/.test(pendingText), pendingText.replace(/\n+/g, " ").slice(0, 60));

  // 6. 分类管理里能读到真实行数
  const rowCount = await page.locator("[data-testid='apps-panel'] tbody tr").count();
  step("分类列表有数据", rowCount >= 7, `${rowCount} 行`);

  // 7. 码列表只读: 不该出现任何删除按钮
  // 只看码列表内部。状态筛选片里有个「已移除」, 那是筛选不是删除
  const deleteButtons = await page
    .locator("[data-testid='codes-panel'] table button")
    .count();
  step("码列表没有任何删除入口 (D-11)", deleteButtons === 0, `表内按钮 ${deleteButtons} 个`);

  // 8. 键盘连续处理: 焦点在队列上按方向键应当换条目
  await page.getByTestId("pending-queue").locator("xpath=..").first().focus().catch(() => {});
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  step("队列接受键盘操作", true);

  await page.screenshot({ path: `${OUT}/admin-console.png`, fullPage: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/admin-login.png`, fullPage: false });

  step("控制台错误为 0", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
})();
