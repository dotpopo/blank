import InviteCard from "@/components/InviteCard";
import type { InviteEntry } from "@/types/invite";

interface InviteGridProps {
  invites: InviteEntry[];
  onOpen: (invite: InviteEntry) => void;
}

export default function InviteGrid({ invites, onOpen }: InviteGridProps) {
  if (!invites.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-[#d9dfd9] bg-white/60 px-5 py-12 text-center text-muted">
        没有找到匹配内容，试试其他关键词或分类。
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-md:grid-cols-2 max-[520px]:grid-cols-1">
      {invites.map((invite) => (
        <InviteCard key={invite.id} invite={invite} onOpen={onOpen} />
      ))}
    </div>
  );
}
