import type { Quota } from "../types/domain";
import { PoolError } from "./seam";

/**
 * 配额与浏览器标识。
 *
 * 这两样都不属于数据源: 配额按 spec 存在浏览器本地 (清缓存就重置, 只是给个刹车),
 * 浏览器标识用来给领取做标记。所以演示适配器和 Supabase 适配器共用这一份。
 */

const QUOTA_KEY = "shuixian.quota.v1";
const BROWSER_KEY = "shuixian.browser.v1";

/** 每个浏览器、每个应用、每天, 领取 / 贡献 / 骰子各几次 (决策 D-6) */
export const PER_DAY = 3;

export type SpendKind = "claim" | "contribute" | "roll";

const KIND_LABEL: Record<SpendKind, string> = {
  claim: "领",
  contribute: "放",
  roll: "摇",
};

type Bucket = Record<SpendKind, number>;
type QuotaStore = Record<string, Bucket>;

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

function dayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function bucketKey(appId: string): string {
  return `${appId}|${dayKey()}`;
}

function readStore(): QuotaStore {
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

/** 一个稳定的浏览器标识。只用于给领取打标记, 不做身份识别 */
export function browserId(): string {
  let id = read(BROWSER_KEY);
  if (!id) {
    id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    write(BROWSER_KEY, id);
  }
  return id;
}

export function quotaFor(appId: string): Quota {
  const bucket = getBucket(readStore(), appId);
  const reset = new Date();
  reset.setHours(24, 0, 0, 0);
  return {
    claimLeft: Math.max(0, PER_DAY - bucket.claim),
    contributeLeft: Math.max(0, PER_DAY - bucket.contribute),
    rollLeft: Math.max(0, PER_DAY - bucket.roll),
    perDay: PER_DAY,
    resetsAt: reset.toISOString(),
  };
}

/**
 * 花掉一次额度。超了直接抛 PoolError, UI 不需要认识第二种错误类型。
 * appLabel 只影响文案。
 */
export function spend(appId: string, kind: SpendKind, appLabel?: string): void {
  const store = readStore();
  const bucket = getBucket(store, appId);
  if (bucket[kind] >= PER_DAY) {
    const who = appLabel ? `「${appLabel}」` : "这个分类";
    throw new PoolError(
      "QUOTA_EXCEEDED",
      `${who}今天${KIND_LABEL[kind]}的额度用满了，每个应用每天 ${PER_DAY} 次。`,
    );
  }
  bucket[kind] += 1;
  store[bucketKey(appId)] = bucket;
  write(QUOTA_KEY, JSON.stringify(store));
}

export function resetQuota(): void {
  write(QUOTA_KEY, "{}");
}
