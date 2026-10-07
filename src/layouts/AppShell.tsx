import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { isDemoSource, resetDemoData } from "../data";
import { Tag } from "../components/ui";

const NAV = [
  { to: "/", label: "首页" },
  { to: "/dashboard", label: "大盘" },
];

function BrandMark() {
  return (
    <span
      aria-hidden
      className="grid h-8 w-8 place-items-center rounded-control bg-accent-strong text-[15px] font-medium text-accent-on"
    >
      水
    </span>
  );
}

export default function AppShell() {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-nav border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-5">
          <Link to="/" className="flex items-center gap-2.5 text-ink-strong no-underline">
            <BrandMark />
            <span className="text-[17px] font-medium tracking-tight">水线</span>
          </Link>

          <nav aria-label="主导航" className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-control px-3 py-1.5 text-sm font-medium text-ink-strong"
                      : "rounded-control px-3 py-1.5 text-sm text-dim transition-colors duration-150 ease-out hover:text-ink"
                  }
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {isDemoSource && (
              <Tag tone="warn">
                <span className="hidden sm:inline">演示数据</span>
                <span className="sm:hidden">演示</span>
              </Tag>
            )}
            <Link
              to="/contribute"
              className="rounded-control bg-accent-strong px-3.5 py-2 text-sm font-medium text-accent-on no-underline transition-[filter] duration-150 ease-out hover:brightness-110 active:translate-y-px"
            >
              贡献邀请码
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-5">
        <Outlet />
      </main>

      <footer className="mt-20 border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-5 py-8 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
          <p className="leading-relaxed">
            匿名共享，不记录身份。领取与贡献都在你自己的浏览器里计数，每个应用每天各 3 次。
            {isDemoSource && " 当前展示的是演示数据，存在本地浏览器里。"}
          </p>
          <div className="flex shrink-0 items-center gap-4">
            {isDemoSource && (
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  window.location.reload();
                }}
                className="rounded-control px-1 py-0.5 text-xs text-dim underline decoration-line-strong underline-offset-4 transition-colors duration-150 ease-out hover:text-ink"
              >
                重置演示数据
              </button>
            )}
            <Link
              to="/admin"
              className="rounded-control px-1 py-0.5 text-xs text-dim underline decoration-line-strong underline-offset-4 transition-colors duration-150 ease-out hover:text-ink"
            >
              管理员
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
