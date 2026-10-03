import { Clock } from "lucide-react";
import type { InviteEntry } from "@/types/invite";

interface InviteCardProps {
  invite: InviteEntry;
  onOpen: (invite: InviteEntry) => void;
}

function formatDate(value?: string): string {
  if (!value) return "待验证";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待验证";
  return `验证于 ${date.toLocaleDateString("zh-CN")}`;
}

export default function InviteCard({ invite, onOpen }: InviteCardProps) {
  const remaining = Math.max(0, invite.maxClaims - invite.currentClaims);

  return (
    <article className="flex flex-col rounded-[16px] border border-line bg-white p-[19px] transition duration-200 hover:-translate-y-[3px] hover:border-[#d5e2d8] hover:shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[13px] bg-mint text-[21px]">
            {invite.icon}
          </div>
          <div>
            <h3 className="m-0 mb-1 text-[15px] font-bold">{invite.productName}</h3>
            <small className="text-xs text-muted">{invite.category}</small>
          </div>
        </div>
        <span className="whitespace-nowrap rounded-md bg-[#eff6ef] px-2 py-1 text-[11px] text-[#477057]">
          {invite.tag}
        </span>
      </div>

      <p className="my-4 min-h-[42px] flex-1 text-[13px] leading-relaxed text-[#68756d]">
        {invite.offer}
      </p>

      <div className="flex items-center justify-between gap-2.5 border-t border-[#f0f1ee] pt-3">
        <span className="inline-flex items-center gap-1 text-[11px] text-[#87928b]">
          <Clock className="h-3 w-3" />
          {formatDate(invite.verifiedAt)}
          {invite.maxClaims > 1 && ` · 剩余 ${remaining}`}
        </span>
        <button
          type="button"
          onClick={() => onOpen(invite)}
          className="rounded-lg bg-mint px-3 py-2 text-xs font-semibold text-brand transition hover:bg-[#dcebe0]"
        >
          查看详情 →
        </button>
      </div>
    </article>
  );
}
