import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Dices } from "lucide-react";
import { isDemoSource, pool, PoolError, TTL_WARN_HOURS } from "../data";
import type { App, ClaimSlot, ClaimedCode, PoolSummary, Quota } from "../types/domain";
import { Button, Callout, Chip, EmptyState, Skeleton, Tag } from "../components/ui";

/* ---------- 展示用的小工具 ---------- */

function formatLeft(hoursLeft: number): string {
  if (hoursLeft < 1) return "不到 1 小时";
  if (hoursLeft < 48) return `还剩 ${hoursLeft} 小时`;
  return `还剩 ${Math.round(hoursLeft / 24)} 天`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function errorText(err: unknown): string {
  if (err instanceof PoolError) return err.message;
  if (err instanceof Error) return err.message;
  return "出了点问题，再试一次";
}

/** 复制按钮。复制成功后短暂变成「已复制」, 不做 toast */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      aria-label={`复制 ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // 剪贴板不可用时退回选中, 至少让人能手动复制
          window.prompt("复制这串邀请码", value);
        }
        setDone(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1800);
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-xs text-dim transition-colors duration-150 ease-out hover:border-line-strong hover:text-ink"
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? "已复制" : "复制"}
    </button>
  );
}

/** 领到码之后的结果条。aria-live 让屏幕阅读器也听得到 */
function ResultBar({ result, onDismiss }: { result: ClaimedCode; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="rounded-panel border border-accent-line bg-accent-tint px-4 py-3.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-accent-ink">来自「{result.appName}」</span>
        <Tag tone="accent">{formatLeft((Date.parse(result.expiresAt) - Date.now()) / 36e5)}</Tag>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto rounded-control px-1 text-xs text-accent-ink underline decoration-accent-line underline-offset-4"
        >
          收起
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <code
          data-testid="result-code"
          className="nums flex-1 overflow-x-auto rounded-control bg-surface px-3 py-2 font-mono text-[15px] tracking-wide text-ink-strong"
        >
          {result.code}
        </code>
        <CopyButton value={result.code} label={`${result.appName} 的邀请码`} />
      </div>
    </div>
  );
}

/* ---------- 名额卡 ---------- */

function SlotCard({
  slot,
  claimed,
  onClaim,
  busy,
}: {
  slot: ClaimSlot;
  claimed?: ClaimedCode;
  onClaim: (slotId: string, appId: string) => void;
  busy: boolean;
}) {
  const urgent = slot.hoursLeft < TTL_WARN_HOURS;

  return (
    <div className="flex flex-col rounded-panel border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-strong">{slot.appName}</p>
          <p className="nums mt-1 text-xs text-dim">
            {formatLeft(slot.hoursLeft)} · {formatDate(slot.expiresAt)} 到期
          </p>
        </div>
        {urgent && <Tag tone="warn">快到期</Tag>}
      </div>

      <div className="mt-4">
        {claimed ? (
          <div className="flex items-center gap-2">
            <code className="nums min-w-0 flex-1 overflow-x-auto rounded-control bg-raised px-2.5 py-1.5 font-mono text-xs text-ink-strong">
              {claimed.code}
            </code>
            <CopyButton value={claimed.code} label={`${slot.appName} 的邀请码`} />
          </div>
        ) : (
          <Button
            variant="secondary"
            busy={busy}
            aria-label={`领取 ${slot.appName} 的邀请码`}
            onClick={() => onClaim(slot.id, slot.appId)}
            className="w-full"
          >
            领取
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- 页面 ---------- */

export default function Home() {
  const [summary, setSummary] = useState<PoolSummary | null>(null);
  const [apps, setApps] = useState<App[]>([]);
  const [slots, setSlots] = useState<ClaimSlot[] | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<string>("all");
  const [result, setResult] = useState<ClaimedCode | null>(null);
  const [claimedInGrid, setClaimedInGrid] = useState<Record<string, ClaimedCode>>({});
  const [busy, setBusy] = useState<"claim" | "roll" | null>(null);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);

  // 水位与列表分开刷。从卡片领取时不刷列表, 否则卡片会在光标底下消失
  const refreshSummary = useCallback(async () => {
    setSummary(await pool.summary());
  }, []);

  const refreshSlots = useCallback(async () => {
    setSlots(await pool.latestSlots(20));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, a, l] = await Promise.all([
          pool.summary(),
          pool.apps(),
          pool.latestSlots(20),
        ]);
        if (!alive) return;
        setSummary(s);
        setApps(a);
        setSlots(l);
        if (a.length) setQuota(await pool.quota(a[0].id));
      } catch (err) {
        if (alive) setLoadError(errorText(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const quotaAppId = selectedApp === "all" ? apps[0]?.id : selectedApp;
  useEffect(() => {
    if (!quotaAppId) return;
    let alive = true;
    pool
      .quota(quotaAppId)
      .then((q) => alive && setQuota(q))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [quotaAppId]);

  const visibleSlots = useMemo(
    () => (slots ?? []).filter((s) => selectedApp === "all" || s.appId === selectedApp),
    [slots, selectedApp],
  );

  const runAction = useCallback(
    async (kind: "claim" | "roll", options?: { slotId?: string; appId?: string }) => {
      setBusy(kind);
      setActionError(null);
      setPendingSlot(options?.slotId ?? null);
      try {
        const got = kind === "claim" ? await pool.claim(options) : await pool.roll(options?.appId);
        if (options?.slotId) {
          // 从卡片领取: 卡片原地变成码, 列表不动
          setClaimedInGrid((prev) => ({ ...prev, [options.slotId as string]: got }));
          await refreshSummary();
        } else {
          setResult(got);
          await Promise.all([refreshSummary(), refreshSlots()]);
        }
        setQuota(await pool.quota(got.appId));
      } catch (err) {
        setActionError(errorText(err));
        // 失败多半是这个名额刚被别人拿走, 刷一次让列表回到真实状态
        await Promise.all([refreshSummary(), refreshSlots()]).catch(() => undefined);
      } finally {
        setBusy(null);
        setPendingSlot(null);
      }
    },
    [refreshSummary, refreshSlots],
  );

  const scopedAppId = selectedApp === "all" ? undefined : selectedApp;
  const total = summary?.available ?? 0;

  return (
    <div className="pb-4">
      {/* 水位。左对齐, 数字是主角 */}
      <section className="pt-14 md:pt-20">
        <h1
          data-testid="water-level"
          className="max-w-[16ch] text-4xl font-medium leading-[1.15] tracking-tight text-ink-strong md:text-6xl"
        >
          池子里还有{" "}
          <span className="whitespace-nowrap">
            <span className="nums text-accent">{total}</span> 个邀请码
          </span>
        </h1>

        <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-dim">
          谁都能取，谁都能放。不记名，不看你是谁，只看池子里还剩多少。
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            busy={busy === "claim"}
            disabled={busy !== null || total === 0}
            onClick={() => runAction("claim", { appId: scopedAppId })}
          >
            领一个
          </Button>
          <Button
            variant="secondary"
            busy={busy === "roll"}
            disabled={busy !== null || total === 0}
            onClick={() => runAction("roll", { appId: scopedAppId })}
          >
            <Dices size={16} aria-hidden />
            摇一个
          </Button>
          {quota && (
            <span data-testid="quota-line" className="nums text-sm text-dim">
              这个分类今天还能领 {quota.claimLeft} 次
            </span>
          )}
        </div>

        {result && (
          <div className="mt-6 max-w-[560px]">
            <ResultBar result={result} onDismiss={() => setResult(null)} />
          </div>
        )}

        {actionError && (
          <div className="mt-6 max-w-[560px]">
            <Callout tone="danger" title="没能给你码">
              {actionError}
            </Callout>
          </div>
        )}
      </section>

      {/* 今日概况。两列数字, 和下面的卡片网格是两种版式 */}
      <section className="mt-14">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line">
          <div className="bg-surface px-5 py-4">
            <p className="nums text-2xl font-medium text-ink-strong">
              {summary ? `+${summary.addedToday}` : "-"}
            </p>
            <p className="mt-1 text-xs text-dim">今天放进来的</p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="nums text-2xl font-medium text-ink-strong">
              {summary ? `-${summary.claimedToday}` : "-"}
            </p>
            <p className="mt-1 text-xs text-dim">今天被领走的</p>
          </div>
        </div>
        {isDemoSource && (
          <p className="mt-2.5 text-xs text-dim">
            演示数据源。这两个数字是对演示事件流当天聚合出来的，接上真实库后会来自实际流水。
          </p>
        )}
      </section>

      {/* 可领名额。chip 行 + 卡片网格 */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-medium tracking-tight text-ink-strong">最新的名额</h2>
          <p className="text-xs text-dim">按快到期的排前面</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Chip active={selectedApp === "all"} onClick={() => setSelectedApp("all")}>
            全部
          </Chip>
          {apps.map((app) => (
            <Chip
              key={app.id}
              active={selectedApp === app.id}
              onClick={() => setSelectedApp(app.id)}
            >
              {app.name}
            </Chip>
          ))}
        </div>

        <div className="mt-6">
          {loadError && (
            <Callout tone="danger" title="没能读到池子">
              {loadError}
            </Callout>
          )}

          {!loadError && slots === null && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-[124px] rounded-panel" />
              ))}
            </div>
          )}

          {!loadError && slots !== null && visibleSlots.length === 0 && (
            <EmptyState title={selectedApp === "all" ? "池子现在是空的" : "这个分类暂时没有货"}>
              {selectedApp === "all"
                ? "等有人放进来就有了。你也可以把自己富余的码丢进来。"
                : "换个分类看看，或者把自己手上的码放进这个分类。"}
            </EmptyState>
          )}

          {!loadError && visibleSlots.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleSlots.map((slot) => (
                <SlotCard
                  key={slot.id}
                  slot={slot}
                  claimed={claimedInGrid[slot.id]}
                  busy={busy === "claim" && pendingSlot === slot.id}
                  onClaim={(slotId, appId) => runAction("claim", { slotId, appId })}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 说明。两列文字, 不用卡片 */}
      <section className="mt-16 border-t border-line pt-8">
        <h2 className="text-lg font-medium tracking-tight text-ink-strong">这个池子怎么运转</h2>
        <div className="mt-5 grid gap-6 text-sm leading-relaxed text-dim md:grid-cols-2">
          <p>码被领走就从池子里消失，不会挂在墙上继续占位置。所以这里的数字是「现在还能拿到多少」，不是「历史上一共出现过多少」。</p>
          <p>每个应用分类，每个浏览器，每天各 3 次领取、3 次贡献、3 次摇骰子。计数存在你自己的浏览器里，清掉缓存就会重置，我们不靠这个拦住谁，只是给个刹车。</p>
        </div>
      </section>
    </div>
  );
}
