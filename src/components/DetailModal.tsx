import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import StatusBadge from "@/components/StatusBadge";
import { useInviteStore } from "@/store/inviteStore";
import { useToastStore } from "@/store/toastStore";
import type { InviteEntry } from "@/types/invite";

interface DetailModalProps {
  invite: InviteEntry | null;
  onClose: () => void;
}

export default function DetailModal({ invite, onClose }: DetailModalProps) {
  const claim = useInviteStore((s) => s.claim);
  const showToast = useToastStore((s) => s.show);
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  // 切换产品时重置领取状态
  useEffect(() => {
    setSecret(null);
    setMessage(null);
    setClaiming(false);
  }, [invite?.id]);

  if (!invite) {
    return <Modal open={false} title="" onClose={onClose}>{null}</Modal>;
  }

  const exhausted = invite.currentClaims >= invite.maxClaims;

  async function handleClaim() {
    if (!invite) return;
    setClaiming(true);
    const result = await claim(invite.id);
    setClaiming(false);
    setMessage(result.message);
    if (result.ok) {
      setSecret(result.secretCode ?? null);
      showToast("领取成功，请尽快使用", "success");
    } else {
      showToast(result.message, "error");
    }
  }

  return (
    <Modal open={Boolean(invite)} title={invite.productName} onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <StatusBadge status={invite.status} />
        <span className="text-xs text-muted">{invite.category}</span>
      </div>

      <p className="text-[13px] leading-relaxed text-muted">
        {invite.offer}。由 {invite.submittedBy} 提交，已通过社区与人工审核。
      </p>

      <div className="my-4 rounded-[10px] border border-dashed border-[#d9e5da] bg-[#f6faf6] p-4 text-center font-mono text-brand">
        {secret ?? invite.displayCode}
      </div>

      {message && (
        <p
          className={`mb-3 text-xs ${secret ? "text-brand" : "text-rose-500"}`}
        >
          {message}
        </p>
      )}

      <p className="text-[13px] leading-relaxed text-muted">
        领取前请查看产品官方的适用条件、有效期和地区限制。邀请码数量有限（
        {invite.currentClaims} / {invite.maxClaims}），以官方规则为准。
      </p>

      {secret ? (
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-[10px] bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark"
        >
          已复制，关闭
        </button>
      ) : (
        <button
          type="button"
          disabled={claiming || exhausted}
          onClick={handleClaim}
          className="mt-2 w-full rounded-[10px] bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {exhausted ? "已被领完" : claiming ? "正在领取…" : "领取邀请码"}
        </button>
      )}
    </Modal>
  );
}
