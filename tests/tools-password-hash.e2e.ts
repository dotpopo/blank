import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// tools/password-hash.html is served by the Vite dev server from the project
// root, so it rides on the same web target as the app itself.
const PAGE = "/tools/password-hash.html";

// $2a$<cost>$<22 char salt><31 char hash>
const BCRYPT_COST_12 = /^\$2a\$12\$[./A-Za-z0-9]{53}$/;

// The two status regions are live regions: their accessible name is their
// content, so a role+name query cannot address them. They carry data-testid.
const GEN_STATUS = "gen-status";
const VERIFY_STATUS = "verify-status";
const HASH = "hash-output";

test("turns a password into a bcrypt hash the database can verify", async ({ app, screen }) => {
  await app.open(PAGE);

  await screen.getByLabel("管理员用户名").fill("admin");
  await screen.getByLabel("密码").fill("a-test-password-for-the-hash");
  await screen.getByRole("button", "生成哈希").tap();

  await expect(screen.getByTestId(HASH)).toHaveText(BCRYPT_COST_12);

  const hash = await screen.getByTestId(HASH).textContent();
  expect(hash).toMatch(BCRYPT_COST_12);
  expect(hash).toHaveLength(60);
  expect(hash.startsWith("$2a$12$")).toBe(true);

  // The salt has to be fresh every time, otherwise the hash is reusable.
  // hashing is async (about 370ms at cost 12), so wait for the text to change
  // instead of reading straight after the tap.
  await screen.getByRole("button", "生成哈希").tap();
  await expect(screen.getByTestId(HASH)).not.toHaveText(hash);
  const second = await screen.getByTestId(HASH).textContent();
  expect(second).toMatch(BCRYPT_COST_12);

  // The verify panel must accept the hash it just produced.
  await screen.getByLabel("要校验的密码").fill("a-test-password-for-the-hash");
  await screen.getByRole("button", "校验是否匹配").tap();
  await expect(screen.getByTestId(VERIFY_STATUS)).toHaveText("匹配。");

  // The insert statement is ready to paste, with the username substituted.
  const sql = await screen.getByLabel("写库语句").inputValue();
  expect(sql).toContain("insert into public.admins (username, password_hash)");
  expect(sql).toContain("'admin'");
  expect(sql).toContain("on conflict (username) do update set password_hash = excluded.password_hash;");
});

test("rejects a password that does not match the hash", async ({ app, screen }) => {
  await app.open(PAGE);

  await screen.getByLabel("密码").fill("the-real-password");
  await screen.getByRole("button", "生成哈希").tap();
  await expect(screen.getByTestId(HASH)).toHaveText(BCRYPT_COST_12);

  await screen.getByLabel("要校验的密码").fill("a-different-password");
  await screen.getByRole("button", "校验是否匹配").tap();

  await expect(screen.getByTestId(VERIFY_STATUS)).toHaveText("不匹配。");
});

test("refuses to hash an empty password", async ({ app, screen }) => {
  await app.open(PAGE);

  await screen.getByRole("button", "生成哈希").tap();

  await expect(screen.getByTestId(GEN_STATUS)).toHaveText("先填一个密码。");
  await expect(screen.getByTestId(HASH)).toBeHidden();
});

test("makes no request outside the app's own origin", async ({ app, browser, screen }) => {
  const external: string[] = [];

  await browser.route("**/*", async (route) => {
    const url = route.request.url;
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url)) {
      external.push(url);
    }
    await route.continue();
  });

  await app.open(PAGE);
  await screen.getByLabel("密码").fill("no-network-check");
  await screen.getByRole("button", "生成哈希").tap();
  await expect(screen.getByTestId(HASH)).toHaveText(BCRYPT_COST_12);

  expect(external).toEqual([]);
});
