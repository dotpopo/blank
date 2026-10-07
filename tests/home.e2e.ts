import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * 首页的领取闭环。
 *
 * 这些用例验证的是规则, 不是像素:
 *   - 水位是「现在还能拿到多少」, 领走一个就少一个 (D-2)
 *   - 同一个应用分类, 每个浏览器每天只能领 3 次 (D-6)
 *   - 池子不会把同一个码发两次
 *   - 页面不向站外发请求
 *
 * 演示数据存在浏览器里, 所以每个用例都先走一次「重置演示数据」, 保证从同一个起点开始。
 */

const CODE = /^[A-Z]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const WATER = /池子里还有 (\d+) 个邀请码/;

/** Kestrel 的库存最多(14 个), 够用完 3 次额度还不会把池子抽空 */
const APP = "Kestrel";

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

async function waterLevel(screen: ScreenFixture): Promise<number> {
  const text = (await screen.getByTestId("water-level").textContent()) ?? "";
  const matched = WATER.exec(text);
  if (!matched) throw new Error(`水位文案读不出来: ${text}`);
  return Number(matched[1]);
}

test("点一下就能拿到一个码，水位随之减一", async ({ app, screen }) => {
  await freshStart(app, screen);
  const before = await waterLevel(screen);

  await screen.getByRole("button", "领一个").tap();

  await expect(screen.getByTestId("result-code")).toHaveText(CODE);
  expect(await waterLevel(screen)).toBe(before - 1);
});

test("同一个分类领满 3 次之后被额度拦住", async ({ app, screen }) => {
  await freshStart(app, screen);

  await screen.getByRole("button", APP).tap();
  await expect(screen.getByTestId("quota-line")).toHaveText(`这个分类今天还能领 3 次`);

  for (const left of [2, 1, 0]) {
    await screen.getByRole("button", "领一个").tap();
    await expect(screen.getByTestId("quota-line")).toHaveText(`这个分类今天还能领 ${left} 次`);
  }

  await screen.getByRole("button", "领一个").tap();
  await expect(screen.getByRole("alert")).toHaveText(/用满/);
});

test("同一个分类连领三次，拿到的是三个不同的码", async ({ app, screen }) => {
  await freshStart(app, screen);
  await screen.getByRole("button", APP).tap();

  const seen = new Set<string>();
  let previous = "";

  for (let i = 0; i < 3; i++) {
    await screen.getByRole("button", "领一个").tap();
    if (previous) {
      await expect(screen.getByTestId("result-code")).not.toHaveText(previous);
    } else {
      await expect(screen.getByTestId("result-code")).toHaveText(CODE);
    }
    const text = (await screen.getByTestId("result-code").textContent()) ?? "";
    expect(text).toMatch(CODE);
    seen.add(text);
    previous = text;
  }

  expect(seen.size).toBe(3);
});

test("不向站外发任何请求", async ({ app, browser, screen }) => {
  const external: string[] = [];

  await browser.route("**/*", async (route) => {
    const url = route.request.url;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url)) {
      external.push(url);
    }
    await route.continue();
  });

  await freshStart(app, screen);
  await screen.getByRole("button", "领一个").tap();
  await expect(screen.getByTestId("result-code")).toHaveText(CODE);

  expect(external).toEqual([]);
});
