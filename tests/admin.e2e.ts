import { test } from "@e2e-dev/web";
import { expect } from "e2e";

/**
 * 管理后台在**演示数据源**下的行为。
 *
 * ⚠️ 这个文件只覆盖「后台不可用时要如实说明」这一半。
 *
 * 为什么不做完整后台的 e2e: 后台需要真实数据库 (服务端校验口令、保存会话),
 * 而首页与大盘的用例需要演示数据源 (要能重置、要确定、不能消耗真实库存)。
 * e2e 给应用进程传的环境变量只有一套, 同一个 5173 不可能同时是两种数据源。所以分工是:
 *   - 这里: 演示源下的降级行为, 永远可跑
 *   - tools/verify-admin.cjs: 真实库下的完整后台流程, 需要管理员凭据, 见 docs/spec/testing.md
 */

test("演示数据源下后台如实说明不可用，而不是给一个假登录框", async ({ app, screen }) => {
  await app.open("/admin");

  await expect(screen.getByTestId("admin-demo-notice")).toBeVisible();

  // 关键: 不能出现登录框。没有服务端就没有可校验的口令,
  // 给一个跳过登录的框等于把权限做成摆设
  await expect(screen.getByTestId("admin-username")).toBeHidden();
  await expect(screen.getByTestId("admin-password")).toBeHidden();
});

test("后台不会被绕过登录直接进入", async ({ app, screen }) => {
  await app.open("/admin");

  await expect(screen.getByTestId("pending-queue")).toBeHidden();
  await expect(screen.getByTestId("apps-panel")).toBeHidden();
  await expect(screen.getByTestId("codes-panel")).toBeHidden();
});
