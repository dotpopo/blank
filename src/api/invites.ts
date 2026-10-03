import { seedInvites, seedProducts } from "@/data/seed";
import { supabase } from "@/lib/supabase";
import {
  cleanInviteContent,
  isDomainAllowed,
  makeId,
  maskCode,
} from "@/lib/invite-utils";
import type {
  ClaimResult,
  InviteEntry,
  InviteStatus,
  InviteSubmissionInput,
  ModerationAction,
  Product,
} from "@/types/invite";

/**
 * 数据访问层。
 *
 * - 配置了 Supabase：走数据库（表结构与 `supabase/migrations/0001_moderation.sql` 一致）。
 * - 未配置：回退到 localStorage，让前端功能在没有后端时也可完整演示。
 *
 * 关键安全说明：前端的任何校验都只是体验优化。真实上线时，
 * 「提交 → 清洗 → 去重 → 审核」必须由 Edge Function + 数据库约束 + RLS 兜底。
 */

const LS_INVITES = "opendoor.invites.v1";
const LS_CLAIMS = "opendoor.claims.v1";

/** 单设备领取限流：每小时最多 N 次 */
const CLAIM_LIMIT_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

interface ClaimLog {
  visitorId: string;
  inviteId: string;
  at: number;
}

function readLocalInvites(): InviteEntry[] {
  if (typeof localStorage === "undefined") return [...seedInvites];
  const raw = localStorage.getItem(LS_INVITES);
  if (!raw) {
    localStorage.setItem(LS_INVITES, JSON.stringify(seedInvites));
    return [...seedInvites];
  }
  try {
    const parsed = JSON.parse(raw) as InviteEntry[];
    return Array.isArray(parsed) && parsed.length ? parsed : [...seedInvites];
  } catch {
    return [...seedInvites];
  }
}

function writeLocalInvites(list: InviteEntry[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_INVITES, JSON.stringify(list));
}

function readClaimLogs(): ClaimLog[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_CLAIMS) ?? "[]") as ClaimLog[];
  } catch {
    return [];
  }
}

function writeClaimLogs(logs: ClaimLog[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_CLAIMS, JSON.stringify(logs.slice(-500)));
}

/** 数据库行 → 前端类型（字段统一在迁移脚本中定义） */
function rowToInvite(row: Record<string, unknown>): InviteEntry {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name ?? ""),
    category: String(row.category ?? ""),
    icon: String(row.icon ?? "✦"),
    offer: String(row.offer ?? ""),
    tag: String(row.tag ?? ""),
    status: row.status as InviteStatus,
    codeType: (row.code_type as InviteEntry["codeType"]) ?? "multi_code",
    displayCode: String(row.display_code ?? "****"),
    secretCode: row.secret_code ? String(row.secret_code) : undefined,
    maxClaims: Number(row.max_claims ?? 1),
    currentClaims: Number(row.current_claims ?? 0),
    submittedBy: String(row.submitted_by ?? "匿名"),
    submittedAt: String(row.submitted_at ?? new Date().toISOString()),
    verifiedAt: row.verified_at ? String(row.verified_at) : undefined,
    expiresAt: row.expires_at ? String(row.expires_at) : undefined,
    reviewNote: row.review_note ? String(row.review_note) : undefined,
  };
}

export async function fetchProducts(): Promise<Product[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      category: String(row.category),
      icon: String(row.icon ?? "✦"),
      description: String(row.description ?? ""),
      domainWhitelist: (row.domain_whitelist as string[]) ?? [],
      active: true,
    }));
  }
  return seedProducts;
}

/**
 * 拉取邀请码列表。
 * 匿名访客应当只能拿到 approved 的条目 —— 这一约束由 Supabase RLS 强制执行，
 * 本地回退时我们在前端做同样的过滤。
 */
export async function fetchInvites(): Promise<InviteEntry[]> {
  if (supabase) {
    const { data, error } = await supabase
      .from("invite_codes")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToInvite);
  }
  return readLocalInvites();
}

/** 提交新邀请码（进入待审核队列） */
export async function submitInvite(
  input: InviteSubmissionInput
): Promise<InviteEntry> {
  const product = seedProducts.find((p) => p.name === input.productName);
  const codeType: InviteEntry["codeType"] = /^https?:\/\//i.test(
    input.inviteContent
  )
    ? "link"
    : "multi_code";

  const cleaned = cleanInviteContent(input.inviteContent);
  const domainOk = product
    ? isDomainAllowed(input.inviteContent, product.domainWhitelist)
    : null;

  const entry: InviteEntry = {
    id: makeId("inv"),
    productId: product?.id ?? makeId("product"),
    productName: input.productName.trim(),
    category: input.category || product?.category || "AI 工具",
    icon: product?.icon ?? "✦",
    offer: input.description?.trim() || product?.description || "社区分享的邀请码",
    tag: "待审核",
    status: "pending",
    codeType,
    displayCode: maskCode(cleaned.cleaned, codeType),
    secretCode: cleaned.cleaned,
    maxClaims: 50,
    currentClaims: 0,
    submittedBy: "当前访客",
    submittedAt: new Date().toISOString(),
    reviewNote:
      domainOk === false
        ? "提交域名与产品白名单不一致，需人工重点核查。"
        : undefined,
  };

  if (supabase) {
    // 由 Edge Function 负责清洗/去重；此处仅示意写入。
    // product_id 仅在确为数据库 uuid 时写入，避免本地种子 id 触发外键错误。
    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entry.productId
      );
    const { data, error } = await supabase
      .from("invite_codes")
      .insert({
        ...(uuidLike ? { product_id: entry.productId } : {}),
        product_name: entry.productName,
        category: entry.category,
        offer: entry.offer,
        code_type: entry.codeType,
        display_code: entry.displayCode,
        secret_code: entry.secretCode,
        max_claims: entry.maxClaims,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    return rowToInvite(data);
  }

  const list = readLocalInvites();
  writeLocalInvites([entry, ...list]);
  return entry;
}

/** 审核操作（仅审核员/管理员可用；本地模式下无鉴权，仅作演示） */
export async function moderateInvite(
  id: string,
  action: ModerationAction,
  reason?: string
): Promise<InviteEntry | null> {
  const nextStatus: InviteStatus =
    action === "approve"
      ? "approved"
      : action === "reject"
        ? "rejected"
        : action === "request_changes"
          ? "needs_changes"
          : "exhausted";

  if (supabase) {
    const { data, error } = await supabase
      .from("invite_codes")
      .update({ status: nextStatus, review_note: reason ?? null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return rowToInvite(data);
  }

  let updated: InviteEntry | null = null;
  const list = readLocalInvites().map((item) => {
    if (item.id !== id) return item;
    updated = {
      ...item,
      status: nextStatus,
      reviewNote: reason,
      tag: statusToTag(nextStatus),
      verifiedAt:
        nextStatus === "approved" ? new Date().toISOString() : item.verifiedAt,
    };
    return updated;
  });
  writeLocalInvites(list);
  return updated;
}

function statusToTag(status: InviteStatus): string {
  switch (status) {
    case "approved":
      return "社区精选";
    case "rejected":
      return "已驳回";
    case "needs_changes":
      return "需修改";
    case "exhausted":
      return "已领完";
    case "expired":
      return "已过期";
    default:
      return "待审核";
  }
}

/**
 * 领取邀请码。
 * 本地模式下模拟：状态校验 + 单设备每小时限流 + 计数。
 * 线上应改为调用 `claim_code` RPC（行锁 + 原子自增）。
 */
export async function claimInvite(
  id: string,
  visitorId: string
): Promise<ClaimResult> {
  if (supabase) {
    const { data, error } = await supabase.rpc("claim_code", {
      p_code_id: id,
      p_visitor_hash: visitorId,
    });
    if (error) return { ok: false, message: error.message };
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      ok: Boolean(row.ok),
      secretCode: row.secret_code ? String(row.secret_code) : undefined,
      message: String(row.message ?? ""),
      remaining: row.remaining != null ? Number(row.remaining) : undefined,
    };
  }

  const now = Date.now();
  const logs = readClaimLogs().filter((l) => now - l.at < HOUR_MS);
  const recent = logs.filter(
    (l) => l.visitorId === visitorId && now - l.at < HOUR_MS
  );
  if (recent.length >= CLAIM_LIMIT_PER_HOUR) {
    return {
      ok: false,
      message: `操作过于频繁：单设备每小时最多领取 ${CLAIM_LIMIT_PER_HOUR} 个邀请码，请稍后再试。`,
    };
  }

  const list = readLocalInvites();
  const target = list.find((item) => item.id === id);
  if (!target) return { ok: false, message: "邀请码不存在或已下架。" };
  if (target.status !== "approved") {
    return { ok: false, message: "该邀请码尚未通过审核或已下架。" };
  }
  if (target.currentClaims >= target.maxClaims) {
    writeLocalInvites(
      list.map((item) =>
        item.id === id ? { ...item, status: "exhausted" } : item
      )
    );
    return { ok: false, message: "该邀请码已被领完。" };
  }

  const nextClaims = target.currentClaims + 1;
  writeLocalInvites(
    list.map((item) =>
      item.id === id
        ? {
            ...item,
            currentClaims: nextClaims,
            status: nextClaims >= item.maxClaims ? "exhausted" : item.status,
          }
        : item
    )
  );
  writeClaimLogs([...logs, { visitorId, inviteId: id, at: now }]);

  return {
    ok: true,
    secretCode: target.secretCode,
    message: "领取成功，请尽快在官方渠道使用。",
    remaining: Math.max(0, target.maxClaims - nextClaims),
  };
}

/** 获取（或创建）当前访客的本地标识，用于领取限流 */
export function getVisitorId(): string {
  if (typeof localStorage === "undefined") return "server";
  const key = "opendoor.visitor.v1";
  let id = localStorage.getItem(key);
  if (!id) {
    id = makeId("visitor");
    localStorage.setItem(key, id);
  }
  return id;
}
