import { useMemo, useState } from "react";
import Modal from "@/components/Modal";
import { seedProducts } from "@/data/seed";
import { CATEGORIES, cleanInviteContent } from "@/lib/invite-utils";
import { useInviteStore } from "@/store/inviteStore";
import { useToastStore } from "@/store/toastStore";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ShareModal({ open, onClose }: ShareModalProps) {
  const submit = useInviteStore((s) => s.submit);
  const showToast = useToastStore((s) => s.show);

  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState<string>("AI 工具");
  const [inviteContent, setInviteContent] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useMemo(
    () => (inviteContent ? cleanInviteContent(inviteContent) : null),
    [inviteContent]
  );

  function reset() {
    setProductName("");
    setCategory("AI 工具");
    setInviteContent("");
    setDescription("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!productName.trim() || !inviteContent.trim()) return;
    setBusy(true);
    try {
      await submit({
        productName: productName.trim(),
        category,
        inviteContent: check?.cleaned ?? inviteContent.trim(),
        description,
      });
      showToast("提交成功，已进入审核队列，通过后公开展示。", "success");
      reset();
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "提交失败，请重试", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="分享一个邀请码" onClose={onClose}>
      <p className="text-[13px] leading-relaxed text-muted">
        提交产品名称和邀请信息，帮助其他人发现好产品。所有内容都会先进入审核队列。
      </p>

      <form onSubmit={handleSubmit}>
        <div className="my-3.5">
          <label htmlFor="productName" className="mb-1.5 block text-[13px] font-semibold">
            产品名称
          </label>
          <input
            id="productName"
            list="product-options"
            required
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="例如：知行 AI"
            className="w-full rounded-[9px] border border-line px-3 py-2.5 outline-brand/60"
          />
          <datalist id="product-options">
            {seedProducts.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </div>

        <div className="my-3.5">
          <label htmlFor="category" className="mb-1.5 block text-[13px] font-semibold">
            分类
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-[9px] border border-line bg-white px-3 py-2.5 outline-brand/60"
          >
            {CATEGORIES.filter((c) => c !== "全部").map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="my-3.5">
          <label htmlFor="inviteContent" className="mb-1.5 block text-[13px] font-semibold">
            邀请码或邀请链接
          </label>
          <input
            id="inviteContent"
            required
            value={inviteContent}
            onChange={(e) => setInviteContent(e.target.value)}
            placeholder="粘贴邀请码或邀请链接"
            className="w-full rounded-[9px] border border-line px-3 py-2.5 outline-brand/60"
          />
          {check?.warnings.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-amber-600">
              {check.warnings.map((w) => (
                <li key={w}>· {w}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="my-3.5">
          <label htmlFor="description" className="mb-1.5 block text-[13px] font-semibold">
            一句话说明（可选）
          </label>
          <input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例如：AI 写作与灵感助手"
            className="w-full rounded-[9px] border border-line px-3 py-2.5 outline-brand/60"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="mt-2 w-full rounded-[10px] bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:bg-slate-300"
        >
          {busy ? "提交中…" : "提交分享"}
        </button>
      </form>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        提交后将进入「待审核」，由审核员确认有效性与安全性后才公开展示。
      </p>
    </Modal>
  );
}
