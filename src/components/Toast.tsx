import { useEffect } from "react";
import { useToastStore } from "@/store/toastStore";

const TONE_CLASS: Record<string, string> = {
  default: "bg-[#203a30]",
  success: "bg-brand",
  error: "bg-rose-600",
};

/** 全局提示条 */
export default function Toast() {
  const { message, tone, hide } = useToastStore();

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(hide, 3200);
    return () => window.clearTimeout(timer);
  }, [message, hide]);

  return (
    <div
      className={[
        "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-[10px] px-4 py-3 text-sm text-white shadow-soft transition-opacity duration-200",
        TONE_CLASS[tone] ?? TONE_CLASS.default,
        message ? "opacity-100" : "pointer-events-none opacity-0",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
