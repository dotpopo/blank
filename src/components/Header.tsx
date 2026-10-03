import { Link, useLocation } from "react-router-dom";
import { Plus } from "lucide-react";

interface HeaderProps {
  onShare: () => void;
}

export default function Header({ onShare }: HeaderProps) {
  const location = useLocation();
  const onHome = location.pathname === "/";
  const hash = (id: string) => (onHome ? `#${id}` : `/#${id}`);

  return (
    <header className="h-[72px] border-b border-line bg-white/90 backdrop-blur">
      <div className="container-page flex h-full items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.4px] text-ink no-underline"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[11px] bg-brand text-lg text-white">
            ↗
          </span>
          <span>
            开门 <span className="font-normal text-[#7b8981]">OpenDoor</span>
          </span>
        </Link>

        <nav className="flex items-center gap-8 text-sm text-[#53625a] max-md:gap-4">
          <a className="hover:text-brand max-md:hidden" href={hash("discover")}>
            发现
          </a>
          <a className="hover:text-brand max-md:hidden" href={hash("categories")}>
            分类
          </a>
          <Link className="hover:text-brand max-md:hidden" to="/admin">
            审核台
          </Link>
          <button
            type="button"
            onClick={onShare}
            className="inline-flex items-center gap-1 rounded-[10px] bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-px hover:bg-brand-dark max-md:px-3 max-md:text-xs"
          >
            <Plus className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> 分享邀请码
          </button>
        </nav>
      </div>
    </header>
  );
}
