import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * 贡献流程。
 *
 * 对应工单 T10 的用例 5 到 7。全部是确定性断言, **不需要模型**。
 *
 * 演示数据存在浏览器里, 所以每个用例先「重置演示数据」回到同一个起点。
 * 贡献的验证锚点是水位数字: 池子里多一个码, 水位就必须涨一。
 * 不直接去列表里找那串码, 因为前台本来就不显示码文 (决策 D-7)。
 */

const WATER = /池子里还有 (\d+) 个邀请码/;

type AppFixture = { open: (path: string) => Promise<unknown> };
type ScreenFixture = {
  getByRole: (role: string, name?: string) => any;
  getByTestId: (id: string) => any;
  getByLabel: (text: string) => any;
};

async function freshStart(app: AppFixture, screen: ScreenFixture) {
  await app.open("/");
  await screen.getByTestId("reset-local").tap();
  await expect(screen.getByTestId("water-level")).toHaveText(WATER);
}

async function waterLevel(screen: ScreenFixture): Promise<number> {
  const text = (await screen.getByTestId("water-level").textContent()) ?? "";
  const matched = WATER.exec(text);
  if (!matched) throw new Error(`水位文案读不出来: ${text}`);
  return Number(matched[1]);
}

/** 填贡献表单并提交。有效期留空就用分类默认值 */
async function contribute(screen: ScreenFixture, code: string) {
  await screen.getByTestId("contribute-code").fill(code);
  await screen.getByRole("button", "放进池子").tap();
}

test("放一个码进池子，水位涨一", async ({ app, screen }) => {
  await freshStart(app, screen);
  const before = await waterLevel(screen);

  await app.open("/contribute");
  await contribute(screen, "E2E-FIRST-0001");
  await expect(screen.getByTestId("contribute-result")).toHaveText(/已经放进/);

  await app.open("/");
  await expect(screen.getByTestId("water-level")).toHaveText(
    new RegExp(`池子里还有 ${before + 1} 个邀请码`),
  );
});

test("同一个码放两次，第二次被拒且额度不扣", async ({ app, screen }) => {
  await freshStart(app, screen);

  await app.open("/contribute");
  await contribute(screen, "E2E-DUPE-0002");
  await expect(screen.getByTestId("contribute-result")).toHaveText(/已经放进/);

  // 第一次放完, 额度应当从 3 变成 2
  await expect(screen.getByTestId("quota-line")).toHaveText("这个分类今天还能放 2 次");

  // 水位只在首页看得到, 先回去记一下
  await app.open("/");
  const before = await waterLevel(screen);

  // 回贡献页, 把同一个码再放一次
  await app.open("/contribute");
  await contribute(screen, "E2E-DUPE-0002");
  await expect(screen.getByTestId("contribute-error")).toHaveText(/已经有这串码了/);

  // 关键: 被拒的这次既不能扣额度, 也不能让水位变
  await expect(screen.getByTestId("quota-line")).toHaveText("这个分类今天还能放 2 次");
  await app.open("/");
  await expect(screen.getByTestId("water-level")).toHaveText(
    new RegExp(`池子里还有 ${before} 个邀请码`),
  );
});

test("提交一个新分类，带着分类与描述进待审", async ({ app, screen }) => {
  await freshStart(app, screen);

  await app.open("/contribute");
  await screen.getByTestId("contribute-app-name").fill("端到端测试分类");
  // 分类与描述是管理员审批时唯一能依据的东西, 所以要能填进去
  await screen.getByTestId("contribute-app-category").fill("效率");
  await screen.getByTestId("contribute-app-desc").fill("端到端测试用的一句话说明");
  await screen.getByTestId("contribute-app-url").fill("https://example.com");
  await screen.getByRole("button", "提交待审").tap();

  await expect(screen.getByTestId("submit-app-result")).toHaveText(/等管理员审批/);

  // 待审的分类不该出现在首页的筛选里, 否则审批就没有意义
  await app.open("/");
  await expect(screen.getByRole("button", "端到端测试分类")).toBeHidden();
});

test("名字撞上已有分类会被拦住，不造重复的待审条目", async ({ app, screen }) => {
  await freshStart(app, screen);

  await app.open("/contribute");
  // Kestrel 是演示数据里已有的分类
  await screen.getByTestId("contribute-app-name").fill("Kestrel");

  await expect(screen.getByRole("alert")).toHaveText(/已经在列表里了/);

  // 撞名时提交按钮要禁掉, 否则队列里会堆出一串重复条目 (spec 11.8)
  await expect(screen.getByRole("button", "提交待审")).toBeDisabled();
});
