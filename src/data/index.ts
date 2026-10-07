import { createDemoSource } from "./demo-source";
import type { PoolSource } from "./seam";

export type { ClaimOptions, PoolErrorCode, PoolSource } from "./seam";
export { PoolError } from "./seam";
export { TTL_WARN_HOURS, resetDemoData } from "./demo-source";

/**
 * 当前挂的数据源。
 *
 * 接真实库时只改这一个文件: 新增 supabase-source.ts, 在这里换掉实现。
 * 页面组件一律从 `pool` 取数据, 不认具体适配器。
 */
export const pool: PoolSource = createDemoSource();

/** 数据源是不是演示数据。UI 靠它决定挂不挂「演示数据」标记 */
export const isDemoSource = true;
