import { STATUS_META } from "@/lib/invite-utils";
import type { InviteStatus } from "@/types/invite";

interface StatusBadgeProps {
  status: InviteStatus;
  withDot?: boolean;
}

export default function StatusBadge({ status, withDot = true }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${meta.className}`}
    >
      {withDot && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta.label}
    </span>
  );
}
