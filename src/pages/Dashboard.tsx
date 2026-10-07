import { useCallback, useEffect, useState } from "react";
import { pool } from "../data";
import type { AppStat, Trend, TrendPoint } from "../types/domain";
import { Callout, Chip, EmptyState, Panel, Skeleton } from "../components/ui";

/**
 * 大盘。
 *
 * 它服务的是「供需有没有失衡」, 不是给单个用户看的, 所以只有三样东西:
 * 三个关键数字、一张趋势图、两个榜单。
 *
 * 有一条纪律必须守住: **数据薄的时候要说数据薄**。
 * 池子只有两天数据时画一条平滑曲线, 比不画更糟。
 */

/* ---------- 数字格式 ---------- */

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/* ---------- 趋势图 ---------- */

const W = 720;
const H = 196;
const PAD_X = 6;
const A_TOP = 18;
const A_BOTTOM = 118;
const B_TOP = 138;
const B_BOTTOM = 166;
const LABEL_Y = 186;

function TrendChart({ points }: { points: TrendPoint[] }) {
  const n = points.length;
  const step = n > 1 ? (W - PAD_X * 2) / (n - 1) : 0;
  const x = (i: number) => PAD_X + i * step;

  const flowMax = Math.max(1, ...points.map((p) => Math.max(p.added, p.claimed)));
  const yA = (v: number) => A_BOTTOM - (v / flowMax) * (A_BOTTOM - A_TOP);

  const nets = points.map((p) => p.net);
  const netMin = Math.min(...nets);
  const netMax = Math.max(...nets);
  const netSpan = netMax - netMin || 1;
  const yB = (v: number) => B_BOTTOM - ((v - netMin) / netSpan) * (B_BOTTOM - B_TOP);

  const path = (pick: (p: TrendPoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${yA(pick(p)).toFixed(1)}`).join(" ");

  const netLine = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${yB(p.net).toFixed(1)}`).join(" ");
  const netArea = `${netLine} L${x(n - 1).toFixed(1)} ${B_BOTTOM} L${x(0).toFixed(1)} ${B_BOTTOM} Z`;

  const last = points[n - 1];
  const first = points[0];
  const totalAdded = points.reduce((sum, p) => sum + p.added, 0);
  const totalClaimed = points.reduce((sum, p) => sum + p.claimed, 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      data-testid="trend-chart"
      className="overflow-visible"
      aria-labelledby="trend-title trend-desc"
    >
      <title id="trend-title">新增与消费的每日趋势，以及池子水位的变化</title>
      <desc id="trend-desc">
        从 {first.date} 到 {last.date}，共 {n} 天。这段时间放进 {totalAdded} 个码，领走 {totalClaimed} 个。
        池子水位从 {first.net} 变到 {last.net}。
      </desc>

      {/* 日流量的量程参考线 */}
      <line x1={PAD_X} x2={W - PAD_X} y1={A_TOP} y2={A_TOP} stroke="var(--n-line)" strokeWidth="0.5" />
      <text x={PAD_X} y={A_TOP - 6} fontSize="11" fill="var(--n-text-dim)">
        {flowMax} 个/天
      </text>

      <path d={path((p) => p.claimed)} fill="none" stroke="var(--n-text-dim)" strokeWidth="1.5" />
      <path d={path((p) => p.added)} fill="none" stroke="var(--a)" strokeWidth="1.5" />

      <circle cx={x(n - 1)} cy={yA(last.claimed)} r="2.5" fill="var(--n-text-dim)" />
      <circle cx={x(n - 1)} cy={yA(last.added)} r="2.5" fill="var(--a)" />

      <line x1={PAD_X} x2={W - PAD_X} y1={A_BOTTOM} y2={A_BOTTOM} stroke="var(--n-line-strong)" strokeWidth="0.5" />

      {/* 净水位: 存量, 单独一条量程, 不跟上面共用轴 */}
      <text x={PAD_X} y={B_TOP - 5} fontSize="11" fill="var(--n-text-dim)">
        水位 {netMin} 到 {netMax}
      </text>
      <path d={netArea} fill="var(--a)" fillOpacity="0.12" />
      <path d={netLine} fill="none" stroke="var(--a)" strokeWidth="1.5" />

      <text x={PAD_X} y={LABEL_Y} fontSize="11" fill="var(--n-text-dim)">
        {shortDate(first.date)}
      </text>
      <text x={W - PAD_X} y={LABEL_Y} fontSize="11" fill="var(--n-text-dim)" textAnchor="end">
        {shortDate(last.date)}
      </text>
    </svg>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-dim">
      <span className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
        每天放进来的
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-4 rounded-full bg-dim" />
        每天被领走的
      </span>
      <span className="flex items-center gap-2">
        <span aria-hidden className="h-2 w-4 rounded-sm bg-accent/15" />
        池子水位
      </span>
    </div>
  );
}

/* ---------- 榜单 ---------- */

function Leaderboard({
  title,
  note,
  rows,
  unit,
}: {
  title: string;
  note: string;
  rows: AppStat[];
  unit: string;
}) {
  return (
    <Panel className="p-5">
      <h3 className="text-sm font-medium text-ink-strong">{title}</h3>
      <p className="mt-1 text-xs text-dim">{note}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-dim">这个区间里还没有记录。</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.appId} className="flex items-baseline justify-between gap-4">
              <span className="truncate text-sm text-ink">{row.appName}</span>
              <span className="nums shrink-0 text-sm text-dim">
                {row.value} {unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- 页面 ---------- */

export default function Dashboard() {
  const [days, setDays] = useState<7 | 30>(7);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: number) => {
    setError(null);
    try {
      setTrend(await pool.trend(range));
    } catch (err) {
      setError(err instanceof Error ? err.message : "读不到大盘数据");
    }
  }, []);

  useEffect(() => {
    setTrend(null);
    void load(days);
  }, [days, load]);

  // 数据薄到画不出趋势, 就直说, 不要画一条看起来很有说服力的线
  const tooThin = trend !== null && (trend.spanDays === 0 || trend.coveredDays < 3);
  const partial = trend !== null && !tooThin && trend.spanDays < trend.requestedDays;

  return (
    <div className="max-w-[900px] pb-6 pt-14">
      <h1 className="text-3xl font-medium leading-tight tracking-tight text-ink-strong">
        池子的大盘
      </h1>
      <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-dim">
        它服务的是「供需有没有失衡」这个问题，不是给你一个人看的。所以只有三个数字、一张图、两个榜单。
      </p>

      {error && (
        <div className="mt-8">
          <Callout tone="danger" title="没能读到大盘">
            {error}
          </Callout>
        </div>
      )}

      {!error && trend === null && (
        <div className="mt-10 flex flex-col gap-4">
          <Skeleton className="h-[86px] rounded-panel" />
          <Skeleton className="h-[260px] rounded-panel" />
        </div>
      )}

      {!error && trend !== null && (
        <>
          {/* 三个关键数字。用分隔线而不是卡片, 密度够了就别加盒子 */}
          <section className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
            <div className="bg-surface px-5 py-4">
              <p className="text-xs text-dim">池子里现在有</p>
              <p data-testid="metric-net" className="num-display mt-1.5 text-3xl text-ink-strong">
                {trend.netNow} 个
              </p>
              <p className="nums mt-1 text-xs text-dim">
                相对 {trend.requestedDays} 天前 {signed(trend.netChange)}
              </p>
            </div>
            <div className="bg-surface px-5 py-4">
              <p className="text-xs text-dim">一个码从入池到被领走</p>
              {trend.medianClaimMinutes === null ? (
                <p data-testid="metric-median" className="num-display mt-1.5 text-3xl text-dim">
                  数据不足
                </p>
              ) : (
                <p data-testid="metric-median" className="num-display mt-1.5 text-3xl text-ink-strong">
                  {formatDuration(trend.medianClaimMinutes)}
                </p>
              )}
              <p className="nums mt-1 text-xs text-dim">
                {trend.medianClaimMinutes === null
                  ? `这个区间只有 ${trend.claimSampleSize} 次领取，样本不够取中位数`
                  : `中位数，样本 ${trend.claimSampleSize} 次`}
              </p>
            </div>
            <div className="bg-surface px-5 py-4">
              <p className="text-xs text-dim">今天白白过期</p>
              <p data-testid="metric-expired" className="num-display mt-1.5 text-3xl text-ink-strong">
                {trend.expiredToday} 个
              </p>
              <p className="mt-1 text-xs text-dim">没人领，就浪费掉了</p>
            </div>
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-medium tracking-tight text-ink-strong">放进来的和领走的</h2>
              <div className="flex items-center gap-2">
                <Chip active={days === 7} onClick={() => setDays(7)}>
                  7 天
                </Chip>
                <Chip active={days === 30} onClick={() => setDays(30)}>
                  30 天
                </Chip>
              </div>
            </div>

            <div className="mt-5">
              {tooThin ? (
                <div data-testid="trend-thin">
                  <EmptyState title="数据量不足，趋势暂不可用">
                    目前只有 {trend.spanDays} 天的数据，其中 {trend.coveredDays} 天有记录。
                    少于 3 天有记录时画出来的曲线只是在描述噪声，不如不画。
                  </EmptyState>
                </div>
              ) : (
                <Panel className="p-4 sm:p-6">
                  <Legend />
                  <div className="mt-4">
                    <TrendChart points={trend.points} />
                  </div>
                </Panel>
              )}

              {partial && !tooThin && (
                <p data-testid="trend-note" className="mt-3 text-xs leading-relaxed text-dim">
                  这个区间里只有 {trend.spanDays} 天有数据
                  {trend.firstDay ? `，最早的一条是 ${trend.firstDay}` : ""}
                  。左边没画出来的部分不是「0」，是没有数据。
                </p>
              )}
            </div>
          </section>

          <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Leaderboard
              title="消耗最快"
              note={`${trend.requestedDays} 天里被领走最多`}
              rows={trend.draining}
              unit="个被领走"
            />
            <Leaderboard
              title="积压最多"
              note="现在还剩最多，没人动"
              rows={trend.piledUp}
              unit="个躺着"
            />
          </section>
        </>
      )}
    </div>
  );
}
