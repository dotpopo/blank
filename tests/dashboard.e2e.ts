import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * 大盘的验收。
 *
 * 工单里最硬的两条:
 *   - 领走一条, 净水位要跟着变 (数字是聚合出来的, 不是画上去的)
 *   - 数据薄的时候要如实说, 不能画一条看起来很有说服力的曲线
 *
 * 演示数据存在浏览器里, 所以每个用例都先走一次「重置演示数据」。
 */

const WATER = /池子里还有 (\d+) 个邀请码/;
const COUNT = /(\d+) 个/;

type AppFixture = { open: (path: string) => Promise<unknown> };
type ScreenFixture = {
  getByRole: (role: string, name?: string) => any;
  getByTestId: (id: string) => any;
};

async function freshStart(app: AppFixture, screen: ScreenFixture) {
  await app.open("/");
  await screen.getByTestId("reset-local").tap();
  await expect(screen.getByTestId("water-level")).toHaveText(WATER);
}

async function readCount(screen: ScreenFixture, testId: string): Promise<number> {
  const text = (await screen.getByTestId(testId).textContent()) ?? "";
  const matched = COUNT.exec(text);
  if (!matched) throw new Error(`${testId} 读不出数字: ${text}`);
  return Number(matched[1]);
}

test("大盘把三个关键数字都算出来了", async ({ app, screen }) => {
  await freshStart(app, screen);
  await app.open("/dashboard");

  // 净水位是当前存量, 应当是个正整数
  expect(await readCount(screen, "metric-net")).toBeGreaterThan(0);

  // 今日过期可以是 0, 但必须是个数字, 不能是空
  await expect(screen.getByTestId("metric-expired")).toHaveText(COUNT);

  // 中位领取时长要么给出时长, 要么如实说数据不足。不允许空着
  const median = (await screen.getByTestId("metric-median").textContent()) ?? "";
  expect(median.length).toBeGreaterThan(0);
});

test("趋势图带文字替代，屏幕阅读器能读到关键数字", async ({ app, screen }) => {
  await freshStart(app, screen);
  await app.open("/dashboard");

  // <title>/<desc> 在 DOM 里, 所以 textContent 能读到。这也是它的兜底
  const text = (await screen.getByTestId("trend-chart").textContent()) ?? "";
  expect(text).toContain("共");
  expect(text).toContain("放进");
  expect(text).toContain("领走");
  expect(text).toContain("池子水位从");
});

test("30 天视图如实说明覆盖了多少天", async ({ app, screen }) => {
  await freshStart(app, screen);
  await app.open("/dashboard");

  await screen.getByRole("button", "30 天").tap();

  // 演示数据只有十来天, 所以 30 天视图必须承认自己画不满
  await expect(screen.getByTestId("trend-note")).toHaveText(/只有 \d+ 天有数据/);
  await expect(screen.getByTestId("trend-note")).toHaveText(/不是「0」，是没有数据/);
});

test("领走一个码，大盘的净水位跟着减一", async ({ app, screen }) => {
  await freshStart(app, screen);
  const before = Number(WATER.exec((await screen.getByTestId("water-level").textContent()) ?? "")?.[1]);

  await screen.getByRole("button", "领一个").tap();
  await expect(screen.getByTestId("result-code")).toHaveText(/^[A-Z]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  await app.open("/dashboard");
  expect(await readCount(screen, "metric-net")).toBe(before - 1);
});
