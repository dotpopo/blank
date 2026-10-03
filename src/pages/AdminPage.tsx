import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, RotateCcw, X } from "lucide-react";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/StatusBadge";
import { seedProducts } from "@/data/seed";
import { isDomainAllowed, STATUS_META } from "@/lib/invite-utils";
import { useInviteStore } from "@/store/inviteStore";
import { useToastStore } from "@/store/toastStore";
import type { InviteEntry, InviteStatus, ModerationAction } from "@/types/invite";

type FilterKey = InviteStatus | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "pending", label: "待审核" },
  { key: "needs_changes", label: "需修改" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已驳回" },
  { key: "all", label: "全部" },
];

interface PendingReview {
  id: string;
  action: ModerationAction;
}

export default function AdminPage() {
  const { invites, load, loaded, moderate } = useInviteStore();
  const showToast = useToastStore((s) => s.show);

  const [filter, setFilter] = useState<FilterKey>("pending");
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: invites.length };
    for (const item of invites) {
      result[item.status] = (result[item.status] ?? 0) + 1;
    }
    return result;
  }, [invites]);

  const list = useMemo(
    () =>
      filter === "all"
        ? invites
        : invites.filter((item) => item.status === filter),
    [invites, filter]
  );

  function riskOf(invite: InviteEntry): string | null {
    if (invite.codeType !== "link" || !invite.secretCode) return null;
    const product = seedProducts.find((p) => p.id === invite.productId);
    const allowed = product
      ? isDomainAllowed(invite.secretCode, product.domainWhitelist)
      : null;
    if (allowed === false) return "链接域名与产品白名单不一致，疑似钓鱼/仿冒";
    if (invite.reviewNote?.includes("白名单")) return invite.reviewNote;
    return null;
  }

  async function handleAction(
    invite: InviteEntry,
    action: ModerationAction,
    note?: string
  ) {
    if ((action === "reject" || action === "request_changes") && !note?.trim()) {
      setPendingReview({ id: invite.id, action });
      setReason("");
      return;
    }
    setBusyId(invite.id);
    try {
      await moderate(invite.id, action, note);
      const verb =
        action === "approve"
          ? "已通过"
          : action === "reject"
            ? "已驳回"
            : action === "request_changes"
              ? "已退回修改"
              : "已标记领完";
      showToast(`${invite.productName} ${verb}`, "success");
      setPendingReview(null);
      setReason("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "操作失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white/90 backdrop-blur">
        <div className="container-page flex h-[72px] items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-brand"
            >
              <ArrowLeft className="h-4 w-4" /> 返回首页
            </Link>
            <span className="text-line">|</span>
            <h1 className="text-lg font-bold">审核台</h1>
          </div>
          <span className="rounded-full bg-mint px-3 py-1 text-xs text-brand">
            审核员视图
          </span>
        </div>
      </header>

      <main className="container-page py-8">
        <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          演示说明：本地模式下审核无鉴权。正式上线时本页仅对
          <code className="mx-1 rounded bg-white/70 px-1">moderator/admin</code>
          角色开放，且状态流转由 Supabase RLS + 服务端函数强制，匿名访客拿 anon key
          也无法把 <code className="mx-1 rounded bg-white/70 px-1">status</code> 改为
          approved。
        </div>

        <div className="my-6 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={[
                "rounded-full border px-3.5 py-2 text-[13px] transition",
                filter === f.key
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-white text-[#58665e] hover:border-brand hover:text-brand",
              ].join(" ")}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {!loaded ? (
          <p className="py-10 text-center text-sm text-muted">加载中…</p>
        ) : list.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-[#d9dfd9] bg-white/60 py-12 text-center text-muted">
            当前筛选下没有条目。
          </p>
        ) : (
          <ul className="space-y-3">
            {list.map((invite) => {
              const risk = riskOf(invite);
              const reviewing = pendingReview?.id === invite.id;
              return (
                <li
                  key={invite.id}
                  className="rounded-[14px] border border-line bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 place-items-center rounded-[13px] bg-mint text-[20px]">
                        {invite.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="m-0 text-[15px] font-bold">
                            {invite.productName}
                          </h3>
                          <StatusBadge status={invite.status} />
                        </div>
                        <p className="mb-0 mt-1 text-xs text-muted">
                          {invite.category} · {invite.submittedBy} ·{" "}
                          {new Date(invite.submittedAt).toLocaleString("zh-CN")}
                        </p>
                        <p className="mb-0 mt-2 text-[13px] text-[#68756d]">
                          {invite.offer}
                        </p>
                        <p className="mb-0 mt-2 font-mono text-xs text-brand">
                          脱敏：{invite.displayCode}
                          <span className="mx-2 text-line">|</span>
                          明文：{invite.secretCode ?? "—"}
                        </p>
                        {risk && (
                          <p className="mb-0 mt-2 inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-600">
                            <AlertTriangle className="h-3 w-3" /> {risk}
                          </p>
                        )}
                        {invite.reviewNote && !risk && (
                          <p className="mb-0 mt-2 text-[11px] text-amber-600">
                            备注：{invite.reviewNote}
                          </p>
                        )}
                      </div>
                    </div>

                    {invite.status === "pending" ||
                    invite.status === "needs_changes" ||
                    invite.status === "approved" ? (
                      <div className="flex flex-wrap gap-2">
                        {invite.status !== "approved" && (
                          <button
                            type="button"
                            disabled={busyId === invite.id}
                            onClick={() => handleAction(invite, "approve")}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" /> 通过
                          </button>
                        )}
                        {invite.status === "pending" && (
                          <button
                            type="button"
                            disabled={busyId === invite.id}
                            onClick={() => handleAction(invite, "request_changes")}
                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-[#68756d] transition hover:border-orange-300 hover:text-orange-600 disabled:opacity-50"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> 退回修改
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === invite.id}
                          onClick={() => handleAction(invite, "reject")}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-[#68756d] transition hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> 驳回
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {reviewing && (
                    <div className="mt-3 rounded-[10px] bg-[#f7f8f5] p-3">
                      <label className="mb-1.5 block text-xs font-semibold">
                        {pendingReview?.action === "reject"
                          ? "驳回原因（必填，会展示给提交者）"
                          : "退回修改的说明（必填）"}
                      </label>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        className="w-full rounded-[8px] border border-line px-3 py-2 text-sm outline-brand/60"
                        placeholder={
                          pendingReview?.action === "reject"
                            ? "例如：链接失效 / 疑似钓鱼 / 重复提交"
                            : "例如：请去掉追踪参数后重新提交"
                        }
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          disabled={!reason.trim() || busyId === invite.id}
                          onClick={() =>
                            pendingReview &&
                            handleAction(invite, pendingReview.action, reason)
                          }
                          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          确认提交
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingReview(null);
                            setReason("");
                          }}
                          className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-[#68756d]"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
