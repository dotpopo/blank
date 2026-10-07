import { appSchema, type App, type ClaimSlot, type ClaimedCode, type ContributeInput, type PoolSummary, type Quota, type SubmitAppInput } from "../types/domain";
import { PoolError, type ClaimOptions, type PoolSource } from "./seam";

/**
 * 演示数据源。
 *
 * 它不是「假数据」, 它是一份规则完整的实现, 只是数据存在浏览器里而不是 Postgres。
 * 下面四条规则和 0001_init.sql 里的语义一一对应, 接真实库时行为不变:
 *   1. 每个浏览器、每个应用、每天, 领取/贡献/骰子各 3 次
 *   2. 同一个应用内不允许出现重复的码
 *   3. 过期的码不进池子
 *   4. 骰子按临期加权, 快过期的先被抽走
 */

// 换种子算法时同步升版本号, 免得浏览器里留着旧结构的演示数据
const POOL_KEY = "shuixian.demo.pool.v3";
const QUOTA_KEY = "shuixian.demo.quota.v3";
const PER_DAY = 3;
const TTL_WARN_HOURS = 48;

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

/* ---------- 种子数据 ---------- */

function iso(daysFromNow: number, hoursFromNow = 0): string {
  return new Date(Date.now() + daysFromNow * 864e5 + hoursFromNow * 36e5).toISOString();
}

const SEED_APPS: App[] = [
  { id: "app_mofang", name: "墨方", slug: "mofang", status: "approved", defaultTtlDays: 7, createdAt: iso(-96) },
  { id: "app_kestrel", name: "Kestrel", slug: "kestrel", status: "approved", defaultTtlDays: 14, createdAt: iso(-88) },
  { id: "app_shiguang", name: "拾光", slug: "shiguang", status: "approved", defaultTtlDays: 30, createdAt: iso(-74) },
  { id: "app_camber", name: "Camber", slug: "camber", status: "approved", defaultTtlDays: 10, createdAt: iso(-61) },
  { id: "app_bailu", name: "白鹿", slug: "bailu", status: "approved", defaultTtlDays: 5, createdAt: iso(-52) },
  { id: "app_tapebox", name: "Tapebox", slug: "tapebox", status: "approved", defaultTtlDays: 21, createdAt: iso(-40) },
  { id: "app_northgate", name: "Northgate", slug: "northgate", status: "approved", defaultTtlDays: 60, createdAt: iso(-33) },
  { id: "app_yunqi", name: "云栖笔记", slug: "yunqi", status: "pending", defaultTtlDays: 14, createdAt: iso(-2) },
];

/** 确定性伪随机, 保证每次刷新池子构成一致, 但分布看着是自然的 */
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
  expiresAt: string;
  claimed: boolean;
};

type DemoState = { codes: DemoCode[] };

/** 每个应用投多少码, 故意不均匀, 让水位看着有高有低 */
const STOCK: Record<string, number> = {
  app_mofang: 9,
  app_kestrel: 14,
  app_shiguang: 5,
  app_camber: 7,
  app_bailu: 11,
  app_tapebox: 2,
  app_northgate: 6,
};

function seedState(): DemoState {
  const rnd = lcg(20261007);
  const codes: DemoCode[] = [];
  const prefixes: Record<string, string> = {
    app_mofang: "MF",
    app_kestrel: "KS",
    app_shiguang: "SG",
    app_camber: "CB",
    app_bailu: "BL",
    app_tapebox: "TB",
    app_northgate: "NG",
  };

  for (const app of SEED_APPS) {
    const count = STOCK[app.id] ?? 0;
    for (let i = 0; i < count; i++) {
      // 有效期分布刻意做成三档, 每一档都在验证一条规则:
      //   已过期   -> 验证「过期码不进池子」
      //   临期     -> 验证临期标记与骰子的临期加权
      //   健康库存 -> 撑起正常水位
      const roll = rnd();
      let hours: number;
      if (roll < 0.08) {
        hours = -(2 + Math.floor(rnd() * 30));
      } else if (roll < 0.3) {
        hours = 3 + Math.floor(rnd() * 45);
      } else {
        hours = Math.round((0.35 + rnd() * 0.65) * app.defaultTtlDays * 24);
      }
      codes.push({
        id: `c_${app.id}_${i}`,
        appId: app.id,
        code: makeCode(rnd, prefixes[app.id] ?? "XX"),
        expiresAt: iso(0, hours),
        claimed: false,
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
      if (Array.isArray(parsed.codes) && parsed.codes.length) {
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
  write(QUOTA_KEY, "{}");
}

/* ---------- 规则 1: 配额 ---------- */

type Bucket = { claim: number; contribute: number; roll: number };
type QuotaStore = Record<string, Bucket>;

function dayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function bucketKey(appId: string): string {
  return `${appId}|${dayKey()}`;
}

function readQuota(): QuotaStore {
  const raw = read(QUOTA_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as QuotaStore;
  } catch {
    return {};
  }
}

function getBucket(store: QuotaStore, appId: string): Bucket {
  return store[bucketKey(appId)] ?? { claim: 0, contribute: 0, roll: 0 };
}

function spend(appId: string, kind: keyof Bucket): void {
  const store = readQuota();
  const bucket = getBucket(store, appId);
  if (bucket[kind] >= PER_DAY) {
    throw new PoolError("QUOTA_EXCEEDED", `「${appName(appId)}」今天这项已经用满 ${PER_DAY} 次了`);
  }
  bucket[kind] += 1;
  store[bucketKey(appId)] = bucket;
  write(QUOTA_KEY, JSON.stringify(store));
}

function tomorrow(): string {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

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
  return load().codes.filter((c) => !c.claimed && Date.parse(c.expiresAt) > now);
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
      const pool = available();
      const appsWithStock = new Set(pool.map((c) => c.appId)).size;
      const rnd = lcg(Number(dayKey().replace(/-/g, "")));
      return {
        available: pool.length,
        appsWithStock,
        // 今日新增与消费: 演示值, 页面会明确标注这是演示数据
        addedToday: 6 + Math.floor(rnd() * 9),
        claimedToday: 4 + Math.floor(rnd() * 12),
      };
    },

    async apps(): Promise<App[]> {
      return SEED_APPS.filter((a) => a.status === "approved").map((a) => appSchema.parse(a));
    },

    async latestSlots(limit = 20): Promise<ClaimSlot[]> {
      return [...available()].sort(byUrgency).slice(0, limit).map(toSlot);
    },

    async quota(appId: string): Promise<Quota> {
      const bucket = getBucket(readQuota(), appId);
      return {
        claimLeft: Math.max(0, PER_DAY - bucket.claim),
        contributeLeft: Math.max(0, PER_DAY - bucket.contribute),
        rollLeft: Math.max(0, PER_DAY - bucket.roll),
        perDay: PER_DAY,
        resetsAt: tomorrow(),
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

      spend(candidate.appId, "claim");
      // 领走即从池子里消失, 这是 D-2 的对外行为
      candidate.claimed = true;
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
      spend(picked.appId, "roll");
      picked.claimed = true;
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

      spend(app.id, "contribute");
      load().codes.push({
        id: `c_${app.id}_${Date.now().toString(36)}`,
        appId: app.id,
        code,
        expiresAt: iso(input.ttlDays ?? app.defaultTtlDays),
        claimed: false,
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
