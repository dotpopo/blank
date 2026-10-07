import { getSupabase, hasSupabaseEnv } from "../lib/supabase";
import { PoolError } from "./seam";

/**
 * 管理后台的数据接缝。
 *
 * 和公开池子分开, 因为它是另一套东西: 固定账号、会话 token、能改分类。
 *
 * 只有真实数据库有后台。演示数据源没有服务端, 也就没有可校验的口令,
 * 硬做一个「跳过登录的演示后台」等于把权限做成摆设, 所以不做。
 * 页面对这种情况会如实说明, 而不是给一个假的登录框。
 */

export type AdminSession = {
  token: string;
  username: string;
  /** 毫秒时间戳。过期就要求重新登录, 不静默失败 */
  expiresAt: number;
};

export type PendingApp = {
  appId: string;
  name: string;
  category: string;
  description: string | null;
  url: string | null;
  validityDays: number;
  submittedAt: string;
  /** 提交时一并带进来的待入池码数量 */
  codeCount: number;
};

export type AdminApp = {
  appId: string;
  name: string;
  category: string;
  status: string;
  validityDays: number;
  submittedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
  availableCodes: number;
  claimedCodes: number;
};

export type AdminCode = {
  codeId: string;
  appId: string;
  appName: string;
  /** 服务端只给预览, 不给完整码文。管理员不需要看到完整的码 */
  codePreview: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  claimedAt: string | null;
};

/** 会话失效。UI 靠它决定是提示重新登录还是普通报错 */
export class SessionExpired extends Error {
  constructor() {
    super("登录已过期，请重新登录");
    this.name = "SessionExpired";
  }
}

/** 服务端的自定义错误码, 见 0001_init.sql */
const SESSION_CODES = new Set(["IP008", "IP009"]);

function mapError(error: { code?: string | null; message?: string }): Error {
  if (error.code && SESSION_CODES.has(String(error.code))) return new SessionExpired();
  return new PoolError("BAD_INPUT", error.message || "操作没能完成");
}

async function adminRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw mapError(error);
  return data as T;
}

/* ---------- 服务端返回的原始形状 ---------- */

type RawLogin = { token: string; username: string; expiresInSeconds: number };

type RawPending = {
  app_id: string;
  name: string;
  category: string;
  description: string | null;
  url: string | null;
  validity_days: number;
  submitted_at: string;
  code_count: number | string;
};

type RawAdminApp = {
  app_id: string;
  name: string;
  category: string;
  status: string;
  validity_days: number;
  submitted_at: string;
  reviewed_at: string | null;
  reject_reason: string | null;
  available_codes: number | string;
  claimed_codes: number | string;
};

type RawAdminCode = {
  code_id: string;
  app_id: string;
  app_name: string;
  code_preview: string;
  status: string;
  expires_at: string;
  created_at: string;
  claimed_at: string | null;
};

const num = (value: number | string | null): number => Number(value ?? 0);

export const adminAvailable = hasSupabaseEnv;

export function createAdminSource() {
  return {
    async login(username: string, password: string): Promise<AdminSession> {
      const raw = await adminRpc<RawLogin>("admin_login", {
        p_username: username,
        p_password: password,
      });
      return {
        token: raw.token,
        username: raw.username,
        expiresAt: Date.now() + raw.expiresInSeconds * 1000,
      };
    },

    async logout(token: string): Promise<void> {
      await adminRpc("admin_logout", { p_token: token });
    },

    async pendingApps(token: string): Promise<PendingApp[]> {
      const rows = await adminRpc<RawPending[]>("admin_pending_apps", { p_token: token });
      return rows.map((row) => ({
        appId: row.app_id,
        name: row.name,
        category: row.category,
        description: row.description,
        url: row.url,
        validityDays: row.validity_days,
        submittedAt: row.submitted_at,
        codeCount: num(row.code_count),
      }));
    },

    async reviewApp(
      token: string,
      appId: string,
      approve: boolean,
      validityDays?: number,
      reason?: string,
    ): Promise<void> {
      await adminRpc("admin_review_app", {
        p_token: token,
        p_app_id: appId,
        p_approve: approve,
        p_validity_days: validityDays ?? null,
        p_reason: reason ?? null,
      });
    },

    async apps(token: string, status?: string): Promise<AdminApp[]> {
      const rows = await adminRpc<RawAdminApp[]>("admin_apps", {
        p_token: token,
        p_status: status ?? null,
      });
      return rows.map((row) => ({
        appId: row.app_id,
        name: row.name,
        category: row.category,
        status: row.status,
        validityDays: row.validity_days,
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        rejectReason: row.reject_reason,
        availableCodes: num(row.available_codes),
        claimedCodes: num(row.claimed_codes),
      }));
    },

    async codes(token: string, appId?: string, status?: string): Promise<AdminCode[]> {
      const rows = await adminRpc<RawAdminCode[]>("admin_codes", {
        p_token: token,
        p_app_id: appId ?? null,
        p_status: status ?? null,
        p_limit: 200,
      });
      return rows.map((row) => ({
        codeId: row.code_id,
        appId: row.app_id,
        appName: row.app_name,
        codePreview: row.code_preview,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        claimedAt: row.claimed_at,
      }));
    },

    /** 改一个已通过分类的默认有效期。只影响 future 的码, 加上池子里还没被领走且没自定义到期时间的码 */
    async setAppValidity(
      token: string,
      appId: string,
      validityDays: number,
    ): Promise<{ oldValidityDays: number; affectedCodes: number }> {
      const raw = await adminRpc<{ oldValidityDays?: number; affectedCodes?: number }>(
        "admin_set_app_validity",
        { p_token: token, p_app_id: appId, p_validity_days: validityDays },
      );
      return {
        oldValidityDays: num(raw?.oldValidityDays ?? validityDays),
        affectedCodes: num(raw?.affectedCodes ?? 0),
      };
    },


    async addApp(
      token: string,
      name: string,
      category: string,
      validityDays: number,
    ): Promise<void> {
      await adminRpc("admin_add_app", {
        p_token: token,
        p_name: name,
        p_category: category,
        p_validity_days: validityDays,
      });
    },

    async removeApp(token: string, appId: string): Promise<{ abandonedCodes: number }> {
      const raw = await adminRpc<{ abandonedCodes?: number }>("admin_remove_app", {
        p_token: token,
        p_app_id: appId,
      });
      return { abandonedCodes: raw?.abandonedCodes ?? 0 };
    },
  };
}

export type AdminSource = ReturnType<typeof createAdminSource>;

/* ---------- 会话。存 sessionStorage, 关掉标签页就没了 ---------- */

const SESSION_KEY = "shuixian.admin.session.v1";

export function readSession(): AdminSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: AdminSession | null): void {
  try {
    if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* 存不了就只活在内存里, 下次刷新要重新登录, 不影响正确性 */
  }
}
