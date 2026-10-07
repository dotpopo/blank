import {
  appSchema,
  type App,
  type AppStat,
  type ClaimSlot,
  type ClaimedCode,
  type ContributeInput,
  type PoolSummary,
  type Quota,
  type SubmitAppInput,
  type Trend,
  type TrendPoint,
} from "../types/domain";
import { quotaFor, spend } from "./quota";
import { PoolError, type ClaimOptions, type PoolSource } from "./seam";

/**
 * 演示数据源。
 *
 * 它不是「假数据」, 它是一份规则完整的实现, 只是数据存在浏览器里而不是 Postgres。
 * 下面几条规则和 0001_init.sql 里的语义一一对应, 接真实库时行为不变:
 *   1. 每个浏览器、每个应用、每天, 领取/贡献/骰子各 3 次
 *   2. 同一个应用内不允许出现重复的码
 *   3. 过期的码不进池子
 *   4. 骰子按临期加权, 快过期的先被抽走
 *
 * 池子不是一次性生成好的静态数组, 而是**一条有时间的事件流**:
 * 每个码有自己的入池时间, 一部分在入池后被领走, 一部分自然过期。
 * 首页的水位、今日新增/消费, 大盘的每一条曲线, 全部是对这条流做聚合算出来的,
 * 没有一个是写死的数字。所以大盘的曲线会随你的操作真的动。
 */

// 换种子结构时同步升版本号, 免得浏览器里留着旧结构的演示数据
const POOL_KEY = "shuixian.demo.pool.v4";
const TTL_WARN_HOURS = 24;
/** 演示数据的回溯天数。大于它, 大盘会如实说「这个区间只有 N 天有数据」 */
const HISTORY_DAYS = 12;
/** 中位数的可信样本下限。低于它就返回 null, UI 要如实说数据不足 */
const MIN_SAMPLE = 3;

/* ---------- 存储。localStorage 不可用时退回内存, 不让页面崩 ---------- */

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

/* ---------- 时间工具 ---------- */

function dayKeyOf(at: number | Date): string {
  const d = typeof at === "number" ? new Date(at) : at;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 36e5).toISOString();
}

/* ---------- 种子 ---------- */

const SEED_APPS: App[] = [
  { id: "app_mofang", name: "墨方", slug: "mofang", status: "approved", defaultTtlDays: 7, createdAt: isoHoursFromNow(-96 * 24) },
  { id: "app_kestrel", name: "Kestrel", slug: "kestrel", status: "approved", defaultTtlDays: 14, createdAt: isoHoursFromNow(-88 * 24) },
  { id: "app_shiguang", name: "拾光", slug: "shiguang", status: "approved", defaultTtlDays: 30, createdAt: isoHoursFromNow(-74 * 24) },
  { id: "app_camber", name: "Camber", slug: "camber", status: "approved", defaultTtlDays: 10, createdAt: isoHoursFromNow(-61 * 24) },
  { id: "app_bailu", name: "白鹿", slug: "bailu", status: "approved", defaultTtlDays: 5, createdAt: isoHoursFromNow(-52 * 24) },
  { id: "app_tapebox", name: "Tapebox", slug: "tapebox", status: "approved", defaultTtlDays: 21, createdAt: isoHoursFromNow(-40 * 24) },
  { id: "app_northgate", name: "Northgate", slug: "northgate", status: "approved", defaultTtlDays: 60, createdAt: isoHoursFromNow(-33 * 24) },
  { id: "app_yunqi", name: "云栖笔记", slug: "yunqi", status: "pending", defaultTtlDays: 14, createdAt: isoHoursFromNow(-2 * 24) },
];

/** 确定性伪随机, 保证每次播种的构成一致, 但分布看着是自然的 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(rnd: () => number, prefix: string): string {
  const block = () =>
    Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)]).join("");
  return `${prefix}-${block()}-${block()}`;
}

type DemoCode = {
  id: string;
  appId: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
};

type DemoState = { codes: DemoCode[] };

const PREFIX: Record<string, string> = {
  app_mofang: "MF",
  app_kestrel: "KS",
  app_shiguang: "SG",
  app_camber: "CB",
  app_bailu: "BL",
  app_tapebox: "TB",
  app_northgate: "NG",
};

/** 每个应用投入多少码。故意不均匀, 让水位和榜单看着有高低 */
const STOCK: Record<string, number> = {
  app_mofang: 15,
  app_kestrel: 24,
  app_shiguang: 9,
  app_camber: 12,
  app_bailu: 18,
  app_tapebox: 5,
  app_northgate: 10,
};

function seedState(): DemoState {
  const rnd = lcg(20261007);
  const codes: DemoCode[] = [];
  const now = Date.now();

  for (const app of SEED_APPS) {
    const count = STOCK[app.id] ?? 0;
    for (let i = 0; i < count; i++) {
      // 入池时间散布在过去 HISTORY_DAYS 天里
      const createdMs = now - Math.round(rnd() * HISTORY_DAYS * 24) * 36e5;

      // 有效期以应用默认值为中心上下浮动。
      // 入池早 + 有效期短 = 自然过期, 不用额外造过期的数据
      const validityHours = Math.max(2, Math.round(app.defaultTtlDays * 24 * (0.5 + rnd() * 1.0)));
      const expiresMs = createdMs + validityHours * 36e5;

      // 约三分之一在入池之后被领走
      let claimedAt: string | undefined;
      if (rnd() < 0.34) {
        const delayHours = 1 + Math.round(rnd() * 54);
        const at = Math.min(createdMs + delayHours * 36e5, expiresMs - 36e5, now - 60e3);
        if (at > createdMs) claimedAt = new Date(at).toISOString();
      }

      codes.push({
        id: `c_${app.id}_${i}`,
        appId: app.id,
        code: makeCode(rnd, PREFIX[app.id] ?? "XX"),
        createdAt: new Date(createdMs).toISOString(),
        expiresAt: new Date(expiresMs).toISOString(),
        claimedAt,
      });
    }
  }
  return { codes };
}

/* ---------- 池子状态 ---------- */

let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  const raw = read(POOL_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState;
      if (Array.isArray(parsed.codes) && parsed.codes.length && "createdAt" in parsed.codes[0]) {
        state = parsed;
        return state;
      }
    } catch {
      /* 存储坏了就重新播种, 不让页面卡住 */
    }
  }
  state = seedState();
  persist();
  return state;
}

function persist(): void {
  if (state) write(POOL_KEY, JSON.stringify(state));
}

/** 清掉演示数据, 回到初始池子。只有演示数据源有这个能力 */
export function resetDemoData(): void {
  state = seedState();
  persist();
}

/* ---------- 规则 1: 配额 ---------- */
// 配额是浏览器本地的事, 和适配器无关, 两个适配器共用 ./quota.ts

/* ---------- 规则 2: 同应用内去重 ---------- */

async function fingerprint(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase().replace(/[\s-]/g, "");
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- 查询 ---------- */

function appName(appId: string): string {
  return SEED_APPS.find((a) => a.id === appId)?.name ?? "未知应用";
}

/** 规则 3: 过期的和已领走的都不进池子 */
function available(): DemoCode[] {
  const now = Date.now();
  return load().codes.filter((c) => !c.claimedAt && Date.parse(c.expiresAt) > now);
}

/** 某个时刻的池子水位。用于算「相对 N 天前的变化」 */
function availableAt(at: number): number {
  return load().codes.filter(
    (c) =>
      Date.parse(c.createdAt) <= at &&
      (!c.claimedAt || Date.parse(c.claimedAt) > at) &&
      Date.parse(c.expiresAt) > at,
  ).length;
}

function toSlot(code: DemoCode): ClaimSlot {
  return {
    id: code.id,
    appId: code.appId,
    appName: appName(code.appId),
    expiresAt: code.expiresAt,
    hoursLeft: Math.max(0, Math.round((Date.parse(code.expiresAt) - Date.now()) / 36e5)),
  };
}

/** 按临期升序。快过期的排前面, 否则这条供给就白费了 */
function byUrgency(a: DemoCode, b: DemoCode): number {
  return Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
}

function median(values: number[]): number | null {
  if (values.length < MIN_SAMPLE) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return Math.round(value);
}

/* ---------- 规则 4: 骰子按临期加权 ---------- */

/**
 * 和 0001_init.sql 里的 order by power(random(), rn) desc 等价。
 * rn 是临期名次, 第 1 名最急。uniform 的随机数更容易取到大值,
 * 所以越临期的码被抽中的概率越高。
 */
function weightedPick(pool: DemoCode[]): DemoCode {
  const ranked = [...pool].sort(byUrgency);
  let best = ranked[0];
  let bestScore = -1;
  ranked.forEach((code, index) => {
    const score = Math.pow(Math.random(), index + 1);
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  });
  return best;
}

/* ---------- 适配器 ---------- */

export function createDemoSource(): PoolSource {
  return {
    async summary(): Promise<PoolSummary> {
      const now = Date.now();
      const today = dayKeyOf(now);
      const codes = load().codes;
      const pool = available();

      return {
        available: pool.length,
        approvedApps: SEED_APPS.filter((a) => a.status === "approved").length,
        // 这两个数字是对事件流当天聚合出来的, 不是写死的
        addedToday: codes.filter((c) => dayKeyOf(Date.parse(c.createdAt)) === today).length,
        claimedToday: codes.filter(
          (c) => c.claimedAt && dayKeyOf(Date.parse(c.claimedAt)) === today,
        ).length,
      };
    },

    async apps(): Promise<App[]> {
      return SEED_APPS.filter((a) => a.status === "approved").map((a) => appSchema.parse(a));
    },

    async latestSlots(limit = 20): Promise<ClaimSlot[]> {
      return [...available()].sort(byUrgency).slice(0, limit).map(toSlot);
    },

    async quota(appId: string): Promise<Quota> {
      return quotaFor(appId);
    },

    async trend(days: number): Promise<Trend> {
      const now = Date.now();
      const todayKey = dayKeyOf(now);
      const rangeStart = startOfDay(now - (days - 1) * 864e5);
      const codes = load().codes;

      const buckets = new Map<string, TrendPoint>();
      const bucketFor = (ms: number): TrendPoint => {
        const date = dayKeyOf(ms);
        let point = buckets.get(date);
        if (!point) {
          point = { date, added: 0, claimed: 0, expired: 0 };
          buckets.set(date, point);
        }
        return point;
      };

      const claimDurations: number[] = [];
      const claimsByApp = new Map<string, number>();

      for (const code of codes) {
        const created = Date.parse(code.createdAt);
        if (created >= rangeStart) bucketFor(created).added += 1;

        if (code.claimedAt) {
          const at = Date.parse(code.claimedAt);
          if (at >= rangeStart) {
            bucketFor(at).claimed += 1;
            claimDurations.push((at - created) / 60000);
            claimsByApp.set(code.appId, (claimsByApp.get(code.appId) ?? 0) + 1);
          }
        } else {
          const expires = Date.parse(code.expiresAt);
          if (expires >= rangeStart && expires <= now) bucketFor(expires).expired += 1;
        }
      }

      const stockByApp = new Map<string, number>();
      for (const code of available()) {
        stockByApp.set(code.appId, (stockByApp.get(code.appId) ?? 0) + 1);
      }

      const rank = (source: Map<string, number>): AppStat[] =>
        [...source.entries()]
          .map(([appId, value]) => ({ appId, appName: appName(appId), value }))
          .sort((a, b) => b.value - a.value || a.appName.localeCompare(b.appName))
          .slice(0, 4);

      const earliest = codes.reduce(
        (min, c) => Math.min(min, Date.parse(c.createdAt)),
        Number.POSITIVE_INFINITY,
      );

      // 横轴覆盖 [max(区间起点, 最早数据), 今天]。
      // 区间内没事件的日子计 0, 那是真实的 0, 不是补出来的;
      // 区间外根本没有数据, 不画, 免得看着像池子突然从 0 涨起来。
      const spanStart = Number.isFinite(earliest)
        ? Math.max(rangeStart, startOfDay(earliest))
        : rangeStart;
      const axis: TrendPoint[] = [];
      for (
        const cursor = new Date(spanStart);
        cursor.getTime() <= now;
        cursor.setDate(cursor.getDate() + 1)
      ) {
        const date = dayKeyOf(cursor);
        const point = buckets.get(date) ?? { date, added: 0, claimed: 0, expired: 0, net: 0 };
        point.net = availableAt(Math.min(cursor.getTime() + 864e5 - 1, now));
        axis.push(point);
      }

      const netNow = available().length;

      return {
        points: axis,
        requestedDays: days,
        spanDays: axis.length,
        coveredDays: buckets.size,
        firstDay: Number.isFinite(earliest) ? dayKeyOf(earliest) : null,
        netNow,
        netChange: netNow - availableAt(rangeStart),
        medianClaimMinutes: median(claimDurations),
        claimSampleSize: claimDurations.length,
        expiredToday: codes.filter(
          (c) =>
            !c.claimedAt &&
            Date.parse(c.expiresAt) <= now &&
            dayKeyOf(Date.parse(c.expiresAt)) === todayKey,
        ).length,
        draining: rank(claimsByApp),
        piledUp: rank(stockByApp),
      };
    },

    async claim(options: ClaimOptions = {}): Promise<ClaimedCode> {
      const pool = available();
      if (!pool.length) {
        throw new PoolError("EMPTY_POOL", "池子里现在没有可领的邀请码");
      }

      let candidate: DemoCode | undefined;
      if (options.slotId) {
        candidate = pool.find((c) => c.id === options.slotId);
        if (!candidate) {
          throw new PoolError("ALREADY_CLAIMED", "这个名额刚刚被别人领走了");
        }
      } else {
        const scoped = options.appId ? pool.filter((c) => c.appId === options.appId) : pool;
        if (!scoped.length) {
          throw new PoolError("EMPTY_POOL", "这个分类下暂时没有可领的码");
        }
        candidate = weightedPick(scoped);
      }

      spend(candidate.appId, "claim", appName(candidate.appId));
      // 领走即从池子里消失, 这是 D-2 的对外行为
      candidate.claimedAt = new Date().toISOString();
      persist();

      return {
        code: candidate.code,
        appId: candidate.appId,
        appName: appName(candidate.appId),
        expiresAt: candidate.expiresAt,
      };
    },

    async roll(appId?: string): Promise<ClaimedCode> {
      const pool = appId ? available().filter((c) => c.appId === appId) : available();
      if (!pool.length) {
        throw new PoolError("EMPTY_POOL", "池子里现在没有可摇的邀请码");
      }
      const picked = weightedPick(pool);
      spend(picked.appId, "roll", appName(picked.appId));
      picked.claimedAt = new Date().toISOString();
      persist();
      return {
        code: picked.code,
        appId: picked.appId,
        appName: appName(picked.appId),
        expiresAt: picked.expiresAt,
      };
    },

    async contribute(input: ContributeInput): Promise<void> {
      const app = SEED_APPS.find((a) => a.id === input.appId);
      if (!app || app.status !== "approved") {
        throw new PoolError("NO_APP", "这个应用分类不存在或还没通过审批");
      }

      const code = input.code.trim();
      const hash = await fingerprint(code);
      const sameApp = load().codes.filter((c) => c.appId === app.id);
      const hashes = await Promise.all(sameApp.map((c) => fingerprint(c.code)));
      if (hashes.includes(hash)) {
        throw new PoolError("DUPLICATE_CODE", `「${app.name}」的池子里已经有这串码了`);
      }

      spend(app.id, "contribute", app.name);
      load().codes.push({
        id: `c_${app.id}_${Date.now().toString(36)}`,
        appId: app.id,
        code,
        createdAt: new Date().toISOString(),
        expiresAt: isoHoursFromNow((input.ttlDays ?? app.defaultTtlDays) * 24),
      });
      persist();
    },

    async submitApp(input: SubmitAppInput): Promise<void> {
      const slug = input.name.trim().toLowerCase().replace(/\s+/g, "-");
      if (SEED_APPS.some((a) => a.slug === slug)) {
        throw new PoolError("DUPLICATE_CODE", `「${input.name}」已经在列表里了`);
      }
      SEED_APPS.push({
        id: `app_${slug}_${Date.now().toString(36)}`,
        name: input.name.trim(),
        slug,
        status: "pending",
        defaultTtlDays: input.ttlDays,
        createdAt: new Date().toISOString(),
      });
    },
  };
}

export { TTL_WARN_HOURS };
