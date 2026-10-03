/**
 * 邀请码共享池 —— 领域类型定义
 *
 * 类型与 `supabase/migrations/0001_moderation.sql` 中的表结构保持一致，
 * 前端数据层在 Supabase 未配置时使用同样的结构（本地回退）。
 */

/** 审核状态机中的状态 */
export type InviteStatus =
  | "pending" // 待审核：仅作者与审核员可见
  | "approved" // 已通过：公开展示
  | "rejected" // 已驳回：前台隐藏，作者可见原因
  | "needs_changes" // 需修改：退回作者补充信息
  | "exhausted" // 已领完 / 失效：前台打标或隐藏
  | "expired"; // 已过期：定时任务自动流转

/** 用户角色 */
export type UserRole = "user" | "moderator" | "admin";

/** 邀请码类型：外链 / 一次性码 / 可多次使用码 */
export type CodeType = "link" | "single_code" | "multi_code";

/** 审核动作 */
export type ModerationAction =
  | "approve"
  | "reject"
  | "request_changes"
  | "mark_exhausted";

/** 产品字典 */
export interface Product {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  /** 允许的链接域名白名单，用于防钓鱼 */
  domainWhitelist: string[];
  active: boolean;
}

/** 邀请码条目（审核队列的主体） */
export interface InviteEntry {
  id: string;
  productId: string;
  /** 冗余的产品展示字段，便于卡片直接渲染 */
  productName: string;
  category: string;
  icon: string;
  /** 一句话卖点 */
  offer: string;
  /** 卡片上的标签，如「社区精选」 */
  tag: string;
  status: InviteStatus;
  codeType: CodeType;
  /** 脱敏后的展示码，如 `ZD-****-7K2`；列表页只下发这个 */
  displayCode: string;
  /** 完整邀请码/链接：仅领取后或作者/审核员可见 */
  secretCode?: string;
  maxClaims: number;
  currentClaims: number;
  submittedBy: string;
  submittedAt: string;
  verifiedAt?: string;
  expiresAt?: string;
  /** 驳回 / 退回原因 */
  reviewNote?: string;
}

/** 提交新邀请码的入参（前端表单） */
export interface InviteSubmissionInput {
  productName: string;
  category: string;
  inviteContent: string;
  description?: string;
}

/** 领取结果 */
export interface ClaimResult {
  ok: boolean;
  secretCode?: string;
  message: string;
  remaining?: number;
}

/** 审核日志 */
export interface ModerationLog {
  id: string;
  inviteId: string;
  operatorId: string | null;
  action: ModerationAction | "submit" | "claim";
  fromStatus: InviteStatus | null;
  toStatus: InviteStatus;
  reason?: string;
  createdAt: string;
}
