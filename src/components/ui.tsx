import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/**
 * 基础控件与四态原语。
 *
 * 规矩:
 *   - 圆角只用 rounded-control (控件) 和 rounded-panel (面板)
 *   - 颜色只从令牌取, 不写死色值
 *   - 主按钮文字与底色对比度按 WCAG AA 校过 (浅色 6.4:1, 深色 4.8:1)
 *   - 每个可点元素都有 focus-visible, 由 index.css 统一给
 */

type ButtonVariant = "primary" | "secondary" | "ghost";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent-strong text-accent-on hover:brightness-110",
  secondary: "bg-accent-tint text-accent-ink hover:bg-accent-tint2",
  ghost: "bg-transparent text-ink border border-line hover:border-line-strong hover:bg-raised",
};

export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-control px-4 py-2.5",
        "text-sm font-medium whitespace-nowrap",
        "transition-[background-color,border-color,transform,filter] duration-150 ease-out",
        "active:translate-y-px",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        BUTTON_VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      aria-pressed={active}
      className={clsx(
        "rounded-control border px-3 py-1.5 text-sm whitespace-nowrap",
        "transition-colors duration-150 ease-out",
        active
          ? "border-accent bg-accent-tint text-accent-ink font-medium"
          : "border-line bg-surface text-dim hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Panel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={clsx("rounded-panel border border-line bg-surface", className)}>{children}</div>
  );
}

/** 小状态标签。只用于真实状态, 不做装饰 */
export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "warn" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-raised text-dim",
    accent: "bg-accent-tint text-accent-ink",
    warn: "bg-warn-tint text-warn",
    danger: "bg-danger-tint text-danger",
  } as const;
  return (
    <span className={clsx("rounded-control px-2 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

/** 表单字段。标签在输入框上方, 帮助文字与错误文字都在下方 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink-strong">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-dim">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={clsx(
        "w-full rounded-control border border-line bg-surface px-3 py-2.5",
        "text-sm text-ink-strong placeholder:text-dim",
        "transition-colors duration-150 ease-out hover:border-line-strong",
        className,
      )}
    />
  );
}

/** 内联提示。错误用 danger, 说明用 neutral */
export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "danger";
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={clsx(
        "rounded-panel border px-4 py-3 text-sm",
        tone === "danger" ? "border-danger bg-danger-tint text-danger" : "border-line bg-raised text-ink",
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={clsx(title && "mt-1", "leading-relaxed")}>{children}</div>}
    </div>
  );
}

/** 骨架。形状要贴近最终内容, 不用转圈 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx("animate-pulse rounded-control bg-raised", className)} />;
}

/** 空态。说清怎么把它填满 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-panel border border-dashed border-line-strong px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink-strong">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-[42ch] text-sm leading-relaxed text-dim">{children}</p>}
    </div>
  );
}
