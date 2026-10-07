import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 客户端。
 *
 * 故意做成**惰性**的: 环境变量缺失时, 这个模块被导入不会炸, 只有真的用到才抛。
 * 否则本地没配变量时整个应用连首页都起不来, 而首页其实跟数据库无关。
 *
 * 只读 anon key。service_role 和数据库连接串**绝对不要**出现在前端代码里,
 * 也不要放进任何以 VITE_ 开头的变量 (Vite 会把被引用到的 VITE_ 变量内联进产物)。
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** 环境变量齐不齐。数据源工厂靠它决定挂哪个适配器 */
export const hasSupabaseEnv = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!url || !anonKey) {
    throw new Error(
      "缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY。它们应当是用户级环境变量。",
    );
  }
  client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
