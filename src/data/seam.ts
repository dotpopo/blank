import type {
  App,
  ClaimSlot,
  ClaimedCode,
  ContributeInput,
  PoolSummary,
  Quota,
  SubmitAppInput,
  Trend,
} from "../types/domain";

/**
 * 数据接缝。
 *
 * 页面只认这个接口, 不认底下是演示数据还是 Supabase。
 * 现在挂的是演示适配器; 接真实库时新增一个 Supabase 适配器, 页面代码一行不动。
 */

export type PoolErrorCode =
  /** 池子空了, 一个可领的都没有 */
  | "EMPTY_POOL"
  /** 这个码在你点之前刚被别人领走 */
  | "ALREADY_CLAIMED"
  /** 过期了, 不进池子 */
  | "EXPIRED"
  /** 同应用内已经有这串码 */
  | "DUPLICATE_CODE"
  /** 应用不存在或没通过审批 */
  | "NO_APP"
  /** 今天的额度用完了 */
  | "QUOTA_EXCEEDED"
  /** 入参不合法 */
  | "BAD_INPUT";

/** 领域错误。UI 靠 code 决定文案, 不靠解析 message */
export class PoolError extends Error {
  readonly code: PoolErrorCode;

  constructor(code: PoolErrorCode, message: string) {
    super(message);
    this.name = "PoolError";
    this.code = code;
  }
}

export interface ClaimOptions {
  /** 指定要领哪一个名额。不传就领最临期的一个 */
  slotId?: string;
  /** 限定在某个应用分类内。不传就是全池 */
  appId?: string;
}

export interface PoolSource {
  /** 水位。首页最大的那个数字 */
  summary(): Promise<PoolSummary>;

  /** 已通过审批的应用分类 */
  apps(): Promise<App[]>;

  /** 最新可领名额。按临期升序, 快过期的排前面。故意不含码文 */
  latestSlots(limit?: number): Promise<ClaimSlot[]>;

  /** 某个应用分类下, 这个浏览器今天还剩多少额度 */
  quota(appId: string): Promise<Quota>;

  /** 大盘。days 是区间天数, 通常 7 或 30 */
  trend(days: number): Promise<Trend>;

  /** 领取。成功才返回码文 */
  claim(options?: ClaimOptions): Promise<ClaimedCode>;

  /** 摇骰子。和领取共用额度逻辑, 但抽出来的是一个码 */
  roll(appId?: string): Promise<ClaimedCode>;

  /** 贡献一个码 */
  contribute(input: ContributeInput): Promise<void>;

  /** 提交一个新应用分类, 进待审 */
  submitApp(input: SubmitAppInput): Promise<void>;
}
