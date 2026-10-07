import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/**
 * 会走的数字。
 *
 * 水位从 43 掉到 42 的时候, 直接换字是「跳」, 滚过去才是「掉」。
 * 这一下滚动是这个站最主要的反馈, 所以值得为它写一个组件。
 *
 * 动效降级时直接换值, 不做补间。
 */
export function CountUp({
  value,
  className,
  duration = 0.6,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef(value);

  useEffect(() => {
    if (reduced || previous.current === value) {
      previous.current = value;
      setShown(value);
      return;
    }

    const controls = animate(previous.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    previous.current = value;

    return () => controls.stop();
  }, [value, reduced, duration]);

  return <span className={className}>{shown}</span>;
}
