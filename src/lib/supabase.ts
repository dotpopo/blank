import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

/**
 * 是否配置了可用的 Supabase 凭据。
 *
 * 注意：未配置时应用不会崩溃，而是自动回退到本地数据层（localStorage），
 * 便于在没有后端凭据的情况下开发与预览。真实上线前请在 `.env` 中配置
 * `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`。
 */
export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseAnonKey !== "your-anon-key-here" &&
    supabaseUrl.startsWith("http")
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;
