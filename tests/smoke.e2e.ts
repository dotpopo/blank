import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * 冒烟: 四条路由都真的渲染出了自己的东西。
 *
 * 原来这里是 e2e init 生成的 example.e2e.ts, 只断言「body 可见」。
 * 白屏也能过, 等于没测, 所以换掉。
 *
 * 全部是确定性断言, 不需要模型。
 */

const ROUTES: { path: string; label: string; check: (screen: any) => any }[] = [
  { path: "/", label: "首页", check: (s) => s.getByTestId("water-level") },
  { path: "/dashboard", label: "大盘", check: (s) => s.getByTestId("metric-net") },
  { path: "/contribute", label: "贡献", check: (s) => s.getByTestId("contribute-code") },
  // 后台有三种形态 (真实库给登录框或工作台, 演示源给说明), 标题是三者共有的
  { path: "/admin", label: "后台", check: (s) => s.getByTestId("admin-title") },
];

for (const route of ROUTES) {
  test(`${route.label}渲染出关键内容`, async ({ app, screen }) => {
    await app.open(route.path);
    await expect(route.check(screen)).toBeVisible();
  });
}

// 需要模型时的写法。本套件刻意不用模型: 更快、更稳、不依赖网关能力。
//
// test("agent 驱动一个流程", async ({ app, agent }) => {
//   await app.open("/");
//   await agent.act("用一句话描述目标");
//   await agent.assert("关于界面的一个问题");
// });
