import { hasSupabaseEnv } from "../lib/supabase";
import { createDemoSource, resetDemoData } from "./demo-source";
import { resetQuota } from "./quota";
import type { PoolSource } from "./seam";
import { createSupabaseSource } from "./supabase-source";

export type { ClaimOptions, PoolErrorCode, PoolSource } from "./seam";
export { PoolError } from "./seam";
export { PER_DAY, storageAvailable, subscribeQuota } from "./quota";
export { TTL_WARN_HOURS } from "./demo-source";

/**
 * 数据源工厂。
 *
 * 环境变量齐 -> 接真实库; 缺 -> 退回演示数据源。
 * 退回不是「假装成功」: 页头会挂「演示数据」标记, 页脚也会说明, 一眼能看出来在跑哪个。
 * 这样即使某个人的机器没配变量, 页面也不会白屏。
 *
 * 页面组件一律从 `pool` 取数据, 不认底下是谁。
 */
export const isDemoSource = !hasSupabaseEnv;

export const pool: PoolSource = isDemoSource ? createDemoSource() : createSupabaseSource();

/** 数据源的一句话说明。UI 用它渲染标记与页脚 */
export const sourceLabel = isDemoSource
  ? "演示数据，存在你自己的浏览器里"
  : "真实数据库";

/**
 * 重置本地状态。配额永远重置;
 * 演示数据源额外重新播种池子, 真实库不动 (不给前端清库的入口)。
 */
export function resetLocalState(): void {
  resetQuota();
  if (isDemoSource) resetDemoData();
}
