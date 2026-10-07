import { getSupabase } from "../lib/supabase";
import type {
  App,
  AppStat,
  ClaimSlot,
  ClaimedCode,
  ContributeInput,
  PoolSummary,
  Quota,
  SubmitAppInput,
  Trend,
  TrendPoint,
} from "../types/domain";
import { browserId, quotaFor, spend } from "./quota";
import { PoolError, type ClaimOptions, type PoolErrorCode, type PoolSource } from "./seam";

/**
 * Supabase 适配器。
 *
 * 和演示适配器产出**完全相同的形状**。差别只在数据来自 Postgres, 规则由 RPC 保证。
 *
 * 有几处必须做映射, 因为 SQL 那边的命名和前端领域模型不一样:
 *   - pool_summary.total            -> available
 *   - apps.validity_days            -> App.defaultTtlDays
 *   - latest_available.seconds_left -> hoursLeft
 *   - pool_health.medianTimeToClaimSeconds -> 分钟
 * 这些差异不是疏忽, 是两边各自命名的结果, 所以映射集中写在下面这一个文件里。
 */

/* ---------- RPC 调用与错误映射 ---------- */

/** SQL 里的自定义错误码 -> 领域错误码。见 0001_init.sql 的 raise exception 处 */
const PG_CODE_MAP: Record<string, PoolErrorCode> = {
  IP001: "ALREADY_CLAIMED",
  IP002: "ALREADY_CLAIMED",
  IP003: "EXPIRED",
  IP004: "DUPLICATE_CODE",
  IP005: "NO_APP",
  IP006: "NO_APP",
  IP010: "EMPTY_POOL",
  IP011: "BAD_INPUT",
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) {
    const code = PG_CODE_MAP[String(error.code ?? "")] ?? "BAD_INPUT";
    // 服务端抛的 message 本来就是给用户看的中文, 直接用
    throw new PoolError(code, error.message || "请求没能完成");
  }
  return data as T;
}

/* ---------- 服务端返回的原始形状 ---------- */

type RawSummary = {
  total: number;
  addedToday: number;
  approvedApps: number;
  claimedToday: number;
  expiredPending: number;
};

type RawHealth = {
  medianTimeToClaimSeconds: number | null;
  claimSampleSize: number;
  expiredUnclaimedTotal: number;
  firstDataAt: string | null;
  approvedApps: number;
};

type RawTrendRow = {
  day: string;
  added: number;
  claimed: number;
  expired_unclaimed: number;
  net: number;
};

type RawRankRow = { app_id: string; app_name: string; claimed: number; available: number };

type RawApp = {
  app_id: string;
  name: string;
  category: string;
  validity_days: number;
  pool_count: number;
};

type RawSlot = {
  code_id: string;
  app_id: string;
  app_name: string;
  expires_at: string;
  seconds_left: number;
};

type RawClaimed = { code: string; appId: string; appName: string; expiresAt: string };

/** 领取用的应用名缓存。quota 要在扣额度前知道应用名, 而 RPC 只给 id */
const appNameCache = new Map<string, string>();

function hoursFromSeconds(seconds: number): number {
  return Math.max(0, Math.round(seconds / 3600));
}

function toClaimed(raw: RawClaimed): ClaimedCode {
  return {
    code: raw.code,
    appId: raw.appId,
    appName: raw.appName,
    expiresAt: raw.expiresAt,
  };
}

export function createSupabaseSource(): PoolSource {
  return {
    async summary(): Promise<PoolSummary> {
      const raw = await rpc<RawSummary>("pool_summary");
      return {
        available: raw.total,
        // 这里给的是「已通过审批的分类数」, 不是「有货的分类数」。
        // 有货的数在 list_apps 的 pool_count 里, 首页不展示, 所以不额外发一次请求。
        approvedApps: raw.approvedApps,
        addedToday: raw.addedToday,
        claimedToday: raw.claimedToday,
      };
    },

    async apps(): Promise<App[]> {
      const rows = await rpc<RawApp[]>("list_apps", { p_limit: 200 });
      const list = rows.map((row) => {
        appNameCache.set(row.app_id, row.name);
        return {
          id: row.app_id,
          name: row.name,
          // 服务端的 app_slug() 规则: 去掉所有空白再转小写。这里对齐一下
          slug: row.name.trim().toLowerCase().replace(/\s+/g, ""),
          status: "approved" as const,
          defaultTtlDays: row.validity_days,
          poolCount: row.pool_count,
        };
      });
      return list;
    },

    async latestSlots(limit = 20): Promise<ClaimSlot[]> {
      const rows = await rpc<RawSlot[]>("latest_available", {
        p_limit: limit,
        p_sort: "expiring",
      });
      return rows.map((row) => {
        appNameCache.set(row.app_id, row.app_name);
        return {
          id: row.code_id,
          appId: row.app_id,
          appName: row.app_name,
          expiresAt: row.expires_at,
          hoursLeft: hoursFromSeconds(row.seconds_left),
        };
      });
    },

    async quota(appId: string): Promise<Quota> {
      // 配额是浏览器本地的事, 不经过服务端
      return quotaFor(appId);
    },

    async trend(days: number): Promise<Trend> {
      const [rows, health, ranking] = await Promise.all([
        rpc<RawTrendRow[]>("pool_trend", { p_days: days }),
        rpc<RawHealth>("pool_health"),
        rpc<RawRankRow[]>("pool_app_ranking", { p_days: days }),
      ]);

      const points: TrendPoint[] = rows.map((row) => ({
        date: row.day,
        added: Number(row.added),
        claimed: Number(row.claimed),
        expired: Number(row.expired_unclaimed),
        net: Number(row.net),
      }));

      // pool_trend 每天都返回, 没事件的日子计 0, 所以「有几天数据」不能靠它数,
      // 要靠 pool_health.firstDataAt 算真实跨度。否则空库也会画出一条很自信的平线。
      const coveredDays = points.filter((p) => p.added + p.claimed + p.expired > 0).length;
      const todayKey = points.length ? points[points.length - 1].date : null;
      const firstDay = health.firstDataAt ? health.firstDataAt.slice(0, 10) : null;
      const spanDays = firstDay
        ? points.filter((p) => p.date >= firstDay).length
        : 0;

      const netNow = points.length ? points[points.length - 1].net : 0;
      const netBefore = points.length ? points[0].net : 0;

      const toStats = (pick: (row: RawRankRow) => number): AppStat[] =>
        [...ranking]
          .map((row) => ({ appId: row.app_id, appName: row.app_name, value: pick(row) }))
          .filter((s) => s.value > 0)
          .sort((a, b) => b.value - a.value || a.appName.localeCompare(b.appName))
          .slice(0, 4);

      return {
        points,
        requestedDays: days,
        spanDays,
        coveredDays,
        firstDay,
        netNow,
        netChange: netNow - netBefore,
        medianClaimMinutes:
          health.medianTimeToClaimSeconds === null
            ? null
            : Math.round(health.medianTimeToClaimSeconds / 60),
        claimSampleSize: Number(health.claimSampleSize ?? 0),
        expiredToday:
          points.length && points[points.length - 1].date === todayKey
            ? points[points.length - 1].expired
            : 0,
        draining: toStats((row) => Number(row.claimed)),
        piledUp: toStats((row) => Number(row.available)),
      };
    },

    async claim(options: ClaimOptions = {}): Promise<ClaimedCode> {
      // 顺序很重要: **先检查额度, 再打服务端**。
      // 反过来的话, 额度已经超了但服务端还是会把码发出去, 用户白丢一个码。
      // 服务端没有「按应用取临期」的入口, 所以本地拉一批再筛。
      const needsList = !options.slotId || !options.appId;
      let rows: RawSlot[] = [];
      if (needsList) {
        rows = await rpc<RawSlot[]>("latest_available", { p_limit: 200, p_sort: "expiring" });
        for (const row of rows) appNameCache.set(row.app_id, row.app_name);
      }

      let codeId = options.slotId;
      let appId = options.appId;

      if (!codeId) {
        const scoped = appId ? rows.filter((r) => r.app_id === appId) : rows;
        if (!scoped.length) {
          throw new PoolError("EMPTY_POOL", "这个分类下暂时没有可领的码");
        }
        codeId = scoped[0].code_id;
        appId = scoped[0].app_id;
      } else if (!appId) {
        appId = rows.find((r) => r.code_id === codeId)?.app_id;
      }

      if (!appId) {
        // 名额不在最近这批里, 说明它已经很靠后了。宁可拒绝, 也不要绕开额度检查
        throw new PoolError("BAD_INPUT", "这个名额已经不在可领列表里了，刷新一下再试");
      }

      spend(appId, "claim", appNameCache.get(appId));

      const raw = await rpc<RawClaimed>("claim_code", {
        p_code_id: codeId,
        p_browser_id: browserId(),
      });
      appNameCache.set(raw.appId, raw.appName);
      return toClaimed(raw);
    },

    async roll(appId?: string): Promise<ClaimedCode> {
      // roll_dice 不接受分类参数, 所以骰子是全池随机。
      // 这是有意的: 骰子是「随便给我一个」的那个按钮, 分类筛选只约束「领一个」。
      void appId;
      // 骰子是服务端随机, 抽到哪个应用事先不知道, 所以只能在抽到之后扣。
      // 这一项没法先检查, 是这套接口的固有限制: 最坏情况是额度已满还多给一个码。
      const raw = await rpc<RawClaimed>("roll_dice", { p_browser_id: browserId() });
      spend(raw.appId, "roll", raw.appName);
      appNameCache.set(raw.appId, raw.appName);
      return toClaimed(raw);
    },

    async contribute(input: ContributeInput): Promise<void> {
      const app = await rpc<RawApp[]>("list_apps", { p_query: null, p_limit: 200 });
      const target = app.find((a) => a.app_id === input.appId);
      if (!target) {
        throw new PoolError("NO_APP", "这个应用分类不存在或还没通过审批");
      }

      // 先扣本地额度, 再打服务端。服务端拒绝时会抛, 但本地额度已经扣了,
      // 这是刻意的取舍: 宁可少给一次, 也不要在网络抖动时给出无限次
      spend(input.appId, "contribute");

      const expiresAt = new Date(
        Date.now() + (input.ttlDays ?? target.validity_days) * 864e5,
      ).toISOString();

      await rpc("contribute_code", {
        p_app_id: input.appId,
        p_code: input.code.trim(),
        p_expires_at: expiresAt,
        p_browser_id: browserId(),
      });
    },

    async submitApp(input: SubmitAppInput): Promise<void> {
      await rpc("submit_app", {
        p_name: input.name.trim(),
        p_category: input.category?.trim() || "其他",
        p_description: input.description?.trim() || null,
        p_url: input.url?.trim() || null,
        p_validity_days: input.ttlDays,
        p_browser_id: browserId(),
      });
    },
  };
}
