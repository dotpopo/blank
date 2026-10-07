import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { youwareVitePlugin } from "@youware/vite-plugin-react";

/**
 * 允许暴露给前端的 VITE_ 变量白名单。
 *
 * 为什么需要这个: Vite 会把**被代码引用到**的 VITE_ 变量原样内联进产物。
 * 也就是说, 只要有人写一句 `import.meta.env.VITE_SUPABASE_SERVICE_ROLE`,
 * 那个 service_role 密钥就会随网页发到每个访客的浏览器里, 而且静默发生、事后很难发现。
 *
 * 真正的修法是把密钥改名去掉 VITE_ 前缀。这道白名单是保险:
 * 白名单外的 VITE_ 变量一律 define 成 undefined, 就算被引用也拿不到值。
 *
 * 要新增一个前端可用的 VITE_ 变量, 必须显式加到这里, 这是有意的摩擦。
 */
const ALLOWED_VITE_VARS = new Set(["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]);

const blockedViteVars = Object.fromEntries(
  Object.keys(process.env)
    .filter((key) => key.startsWith("VITE_") && !ALLOWED_VITE_VARS.has(key))
    .map((key) => [`import.meta.env.${key}`, "undefined"]),
);

// https://vite.dev/config/
export default defineConfig({
  // define 在 Vite 内部的展开顺序里排在自动注入的 import.meta.env.* 之后,
  // 所以这里的 undefined 会覆盖掉内联进来的真实值
  define: blockedViteVars,
  plugins: [youwareVitePlugin(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    sourcemap: true,
  },
});
