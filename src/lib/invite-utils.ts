import type { CodeType, InviteStatus } from "@/types/invite";

/** 各状态的展示元信息（文案 + 样式类） */
export const STATUS_META: Record<
  InviteStatus,
  { label: string; className: string; dot: string }
> = {
  pending: {
    label: "待审核",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400",
  },
  approved: {
    label: "已通过",
    className: "bg-mint text-brand border-brand/20",
    dot: "bg-brand",
  },
  rejected: {
    label: "已驳回",
    className: "bg-rose-50 text-rose-600 border-rose-200",
    dot: "bg-rose-400",
  },
  needs_changes: {
    label: "需修改",
    className: "bg-orange-50 text-orange-600 border-orange-200",
    dot: "bg-orange-400",
  },
  exhausted: {
    label: "已领完",
    className: "bg-slate-100 text-slate-500 border-slate-200",
    dot: "bg-slate-400",
  },
  expired: {
    label: "已过期",
    className: "bg-slate-100 text-slate-500 border-slate-200",
    dot: "bg-slate-400",
  },
};

/** 项目采用的产品分类 */
export const CATEGORIES = [
  "全部",
  "AI 工具",
  "效率",
  "设计创作",
  "开发者",
  "社交",
] as const;

export type CategoryName = (typeof CATEGORIES)[number];

/** 把任意邀请内容生成脱敏展示码 */
export function maskCode(raw: string, codeType: CodeType): string {
  const value = raw.trim();
  if (!value) return "****";

  if (codeType === "link" || /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const token =
        url.searchParams.get("token") ??
        url.searchParams.get("code") ??
        url.searchParams.get("invite");
      return token
        ? `${url.hostname}/****${token.slice(-4)}`
        : `${url.hostname}/****`;
    } catch {
      return "****";
    }
  }

  // 形如 ZX-A7K2-9M3P，保留首尾、隐藏中段
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (compact.length <= 6) return `${compact.slice(0, 2)}****`;
  return `${compact.slice(0, 2)}-****-${compact.slice(-4)}`;
}

/** 判断内容是不是链接 */
export function isLink(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** 提取链接域名 */
export function extractHost(value: string): string | null {
  if (!isLink(value)) return null;
  try {
    return new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "referrer",
  "source",
  "aff",
  "affiliate",
];

const PII_PATTERN = /(@|\b1[3-9]\d{9}\b)/;

export interface CleanResult {
  cleaned: string;
  removedParams: string[];
  hasPii: boolean;
  host: string | null;
  warnings: string[];
}

/**
 * 清洗邀请链接：剥离推广/追踪参数，检测可能的隐私泄露。
 *
 * 注意：这仅是前端辅助提示，**不能作为安全边界**，真正的清洗与校验
 * 必须在服务端（Supabase Edge Function）重复执行一次。
 */
export function cleanInviteContent(value: string): CleanResult {
  const raw = value.trim();
  const result: CleanResult = {
    cleaned: raw,
    removedParams: [],
    hasPii: false,
    host: null,
    warnings: [],
  };

  if (!isLink(raw)) {
    result.hasPii = PII_PATTERN.test(raw);
    if (result.hasPii) result.warnings.push("内容可能包含邮箱/手机号，请确认是否愿意公开。");
    return result;
  }

  try {
    const url = new URL(raw);
    result.host = url.hostname.toLowerCase();

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.includes(key.toLowerCase())) {
        url.searchParams.delete(key);
        result.removedParams.push(key);
      }
    }

    if (PII_PATTERN.test(decodeURIComponent(url.search + url.pathname))) {
      result.hasPii = true;
      result.warnings.push("链接参数中疑似含邮箱或手机号，存在隐私泄露风险。");
    }

    result.cleaned = url.toString();
    if (result.removedParams.length) {
      result.warnings.push(
        `已自动移除追踪参数：${result.removedParams.join(", ")}`
      );
    }
  } catch {
    result.warnings.push("链接格式无法解析，请检查后重试。");
  }

  return result;
}

/** 判断内容链接是否命中产品域名白名单 */
export function isDomainAllowed(
  value: string,
  domainWhitelist: string[]
): boolean | null {
  const host = extractHost(value);
  if (!host) return null; // 非链接，不适用
  return domainWhitelist.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

/** 生成短随机 id（演示用；正式环境由数据库生成 uuid） */
export function makeId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}
