import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * 水面。
 *
 * 这是整个设计概念的落点: 页面就是一条水线, 上面是纸 (空气), 下面是水 (池子)。
 *
 * 水面高度不是装饰, 它是**数据**: level 是当前水位在过去 30 天区间里的位置。
 * 池子满的时候水面高, 快空的时候水面低。数字和水面说的是同一件事。
 *
 * 波纹用两条不同速度的波叠加, 速度差形成视差, 水就有厚度了。
 * 位移单位是 SVG 用户单位, 不是屏幕像素, 所以容器变宽波纹速度依然对得上。
 */

const VW = 1200;
const VH = 110;
/** 一个波长。平移整数个波长就是无缝循环 */
const PERIOD = 600;
const AMP = 4;
/** 水位线在垂直方向的可动范围 */
const SURFACE_HIGH = 18;
const SURFACE_LOW = 92;

function wavePath(surfaceY: number, phase: number): string {
  const step = 12;
  const width = VW + PERIOD;
  let d = `M 0 ${surfaceY}`;
  for (let x = step; x <= width; x += step) {
    const y = surfaceY + Math.sin((x / PERIOD) * Math.PI * 2 + phase) * AMP;
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  d += ` L ${width} ${VH} L 0 ${VH} Z`;
  return d;
}

export function Waterline({
  level,
  rangeMin,
  rangeMax,
  splashKey,
  className,
}: {
  /** 0 到 1。当前水位在区间里的位置 */
  level: number;
  rangeMin: number;
  rangeMax: number;
  /** 每次领取自增。变化时落一滴水 */
  splashKey: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [splash, setSplash] = useState(0);

  const surfaceY = useMemo(() => {
    const clamped = Math.min(1, Math.max(0, level));
    return SURFACE_LOW - clamped * (SURFACE_LOW - SURFACE_HIGH);
  }, [level]);

  const back = useMemo(() => wavePath(surfaceY - 3, 0.9), [surfaceY]);
  const front = useMemo(() => wavePath(surfaceY, 0), [surfaceY]);

  // 领取时落一滴水。动效降级时不落
  useEffect(() => {
    if (splashKey === 0 || reduced) return;
    setSplash(splashKey);
    const timer = window.setTimeout(() => setSplash(0), 1500);
    return () => window.clearTimeout(timer);
  }, [splashKey, reduced]);

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        role="img"
        data-testid="waterline"
        aria-label={`池子水位：过去这段区间最低 ${rangeMin}，最高 ${rangeMax}，现在在这个区间里`}
        className="block"
      >
        <defs>
          {/* 唯一的渐变: 水的深度。越往下越深, 这是物理, 不是装饰 */}
          <linearGradient id="water-depth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--w-top)" />
            <stop offset="100%" stopColor="var(--w-deep)" />
          </linearGradient>
        </defs>

        {/* 后层水: 慢, 深, 给水厚度 */}
        <g className={reduced ? undefined : "wave-back"}>
          <path d={back} fill="var(--w-mid)" opacity="0.55" />
        </g>

        {/* 前层水: 快, 亮, 是真正的水面 */}
        <g className={reduced ? undefined : "wave-front"}>
          <path d={front} fill="url(#water-depth)" />
          {/* 浪尖高光。一像素的线, 让水面有边 */}
          <path d={front} fill="none" stroke="var(--w-crest)" strokeWidth="1.2" opacity="0.7" />
        </g>

        {/* 领取时的那滴水 */}
        <AnimatePresence>
          {splash > 0 && (
            <motion.g key={splash}>
              <motion.circle
                cx={VW * 0.5}
                r={3.5}
                fill="var(--w-crest)"
                initial={{ cy: -24, opacity: 0 }}
                animate={{ cy: [null, surfaceY - 4], opacity: [0, 1, 1] }}
                transition={{ duration: 0.5, ease: "easeIn" }}
              />
              <motion.ellipse
                cx={VW * 0.5}
                cy={surfaceY}
                fill="none"
                stroke="var(--w-crest)"
                strokeWidth="1.5"
                initial={{ rx: 5, ry: 2, opacity: 0 }}
                animate={{ rx: [5, 34], ry: [2, 9], opacity: [0.85, 0] }}
                transition={{ duration: 1, delay: 0.45, ease: "easeOut" }}
              />
            </motion.g>
          )}
        </AnimatePresence>
      </svg>
    </div>
  );
}
