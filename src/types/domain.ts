import { z } from "zod";

/**
 * 领域类型。这些形状是 UI 与数据源之间唯一的契约。
 * 真实数据源(Postgres RPC)与演示数据源必须产出完全相同的形状, 否则换适配器时页面就会崩。
 */

export const appStatusSchema = z.enum(["approved", "pending", "rejected"]);
export type AppStatus = z.infer<typeof appStatusSchema>;

/** 应用分类。审批的对象是它, 不是邀请码。 */
export const appSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: appStatusSchema,
  /** 这个分类下邀请码的默认有效期(天)。邀请码没单独指定就取它。 */
  defaultTtlDays: z.number().int().positive(),
  createdAt: z.string(),
});
export type App = z.infer<typeof appSchema>;

/**
 * 前台能看到的一条可领名额。
 * 故意不含码文: 码文只有真的点了「领取」才会拿到。否则刷新一次就能抄走整页。
 */
export const claimSlotSchema = z.object({
  id: z.string(),
  appId: z.string(),
  appName: z.string(),
  expiresAt: z.string(),
  /** 距过期还剩多少小时。用于「快过期」提示 */
  hoursLeft: z.number(),
});
export type ClaimSlot = z.infer<typeof claimSlotSchema>;

export const poolSummarySchema = z.object({
  /** 池子里还剩多少可领的码。这是全站最大的那个数字 */
  available: z.number().int().nonnegative(),
  /** 有货的分类数 */
  appsWithStock: z.number().int().nonnegative(),
  claimedToday: z.number().int().nonnegative(),
  addedToday: z.number().int().nonnegative(),
});
export type PoolSummary = z.infer<typeof poolSummarySchema>;

/** 一个浏览器、一天、一个应用的三项额度。key 是「应用 + 日期」 */
export const quotaSchema = z.object({
  claimLeft: z.number().int().nonnegative(),
  contributeLeft: z.number().int().nonnegative(),
  rollLeft: z.number().int().nonnegative(),
  /** 每项每日上限, 三项都是 3 */
  perDay: z.number().int().positive(),
  resetsAt: z.string(),
});
export type Quota = z.infer<typeof quotaSchema>;

/** 领取或摇骰子的结果。到这里才第一次出现码文 */
export const claimedCodeSchema = z.object({
  code: z.string(),
  appId: z.string(),
  appName: z.string(),
  expiresAt: z.string(),
});
export type ClaimedCode = z.infer<typeof claimedCodeSchema>;

/** 贡献一个码的入参 */
export const contributeInputSchema = z.object({
  appId: z.string().min(1, "先选一个应用分类"),
  code: z.string().trim().min(4, "邀请码太短了").max(128, "邀请码太长了"),
  /** 可选。不填就取应用的默认有效期 */
  ttlDays: z.number().int().positive().max(3650).optional(),
});
export type ContributeInput = z.infer<typeof contributeInputSchema>;

/** 提交一个新应用分类, 进待审 */
export const submitAppInputSchema = z.object({
  name: z.string().trim().min(1, "应用名不能为空").max(40, "应用名太长了"),
  ttlDays: z.number().int().positive().max(3650),
});
export type SubmitAppInput = z.infer<typeof submitAppInputSchema>;

/** 大盘的一天。区间内没事件的日子也保留, 计 0, 这样横轴是连续的 */
export const trendPointSchema = z.object({
  /** YYYY-MM-DD */
  date: z.string(),
  added: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  /**
   * 当天结束时的池子水位。
   * 注意这是绝对存量, 和上面三个日流量不是一个量纲, 画图时必须单独一条轴,
   * 否则两条线看着相交, 实际毫无可比性。
   */
  net: z.number().int().nonnegative(),
});
export type TrendPoint = z.infer<typeof trendPointSchema>;

export const appStatSchema = z.object({
  appId: z.string(),
  appName: z.string(),
  value: z.number().int().nonnegative(),
});
export type AppStat = z.infer<typeof appStatSchema>;

/**
 * 大盘。所有字段都是从事件流聚合出来的, 没有一个是写死的。
 * 数据薄的时候要能诚实反映出来, 所以带了 coveredDays 和 claimSampleSize。
 */
export const trendSchema = z.object({
  points: z.array(trendPointSchema),
  /** 请求的区间天数 */
  requestedDays: z.number().int().positive(),
  /** points 覆盖的天数, 即真实数据的跨度 */
  spanDays: z.number().int().nonnegative(),
  /** 其中真的有事件的天数。和 spanDays 的差距就是「数据有多薄」 */
  coveredDays: z.number().int().nonnegative(),
  /** 池子最早的数据落在哪天 */
  firstDay: z.string().nullable(),
  /** 当前净水位 */
  netNow: z.number().int().nonnegative(),
  /** 相对区间起点的净变化 */
  netChange: z.number().int(),
  /** 中位领取时长(分钟)。样本不足时为 null, UI 要如实说明 */
  medianClaimMinutes: z.number().nullable(),
  /** 中位数的样本量 */
  claimSampleSize: z.number().int().nonnegative(),
  /** 今天白白过期的码数 */
  expiredToday: z.number().int().nonnegative(),
  /** 消耗最快 */
  draining: z.array(appStatSchema),
  /** 积压最多 */
  piledUp: z.array(appStatSchema),
});
export type Trend = z.infer<typeof trendSchema>;
