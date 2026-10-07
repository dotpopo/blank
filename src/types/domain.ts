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
