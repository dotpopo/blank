import { useEffect, useMemo, useState } from "react";
import CategoryChips from "@/components/CategoryChips";
import DetailModal from "@/components/DetailModal";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import InviteGrid from "@/components/InviteGrid";
import SearchBar from "@/components/SearchBar";
import ShareModal from "@/components/ShareModal";
import { useInviteStore } from "@/store/inviteStore";
import type { CategoryName } from "@/lib/invite-utils";
import type { InviteEntry } from "@/types/invite";

export default function HomePage() {
  const { invites, load } = useInviteStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryName>("全部");
  const [detail, setDetail] = useState<InviteEntry | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  // 首页只展示已通过的邀请码
  const approved = useMemo(
    () => invites.filter((item) => item.status === "approved"),
    [invites]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return approved.filter((item) => {
      const matchesCategory = category === "全部" || item.category === category;
      const searchable =
        `${item.productName} ${item.category} ${item.offer} ${item.tag} ${item.displayCode}`.toLowerCase();
      return matchesCategory && searchable.includes(q);
    });
  }, [approved, category, query]);

  function resetFilters() {
    setQuery("");
    setCategory("全部");
  }

  return (
    <div className="min-h-screen">
      <Header onShare={() => setShareOpen(true)} />

      <section className="bg-[radial-gradient(ellipse_at_50%_0%,rgba(222,238,226,.78),transparent_62%)] py-[76px] pb-[52px] text-center max-md:py-[58px] max-md:pb-[35px]">
        <div className="container-page">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce9df] bg-white/70 px-3 py-1.5 text-xs font-semibold text-brand">
            ✦ 好产品，值得一起发现
          </span>
          <h1 className="mx-auto my-5 mb-3 text-[clamp(36px,5vw,56px)] font-extrabold leading-[1.12] tracking-[-2px]">
            找到好产品的
            <br />
            那扇门
          </h1>
          <p className="mx-auto text-base leading-relaxed text-muted max-[520px]:text-sm">
            发现值得尝试的新工具，也把你手里的机会分享给下一个人。
          </p>

          <SearchBar value={query} onChange={setQuery} onSubmit={() => undefined} />
          <CategoryChips selected={category} onChange={setCategory} />
        </div>
      </section>

      <main id="discover" className="container-page pb-20">
        <div className="my-[30px] mb-[18px] flex items-end justify-between gap-4">
          <div>
            <h2 className="m-0 text-[21px] font-bold tracking-[-0.5px]">
              最近值得关注
            </h2>
            <p className="mb-0 mt-1.5 text-[13px] text-muted">
              社区分享 · 状态以产品官方规则为准（{filtered.length} / {approved.length}）
            </p>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="bg-transparent py-1 text-[13px] font-semibold text-brand"
          >
            查看全部 →
          </button>
        </div>

        <InviteGrid invites={filtered} onOpen={setDetail} />

        <div className="mt-[18px] rounded-[11px] bg-[#f0f3ee] px-4 py-3 text-xs leading-relaxed text-[#68756d]">
          提示：本页邀请码来自社区提交，均经过「自动预检 + 人工复核」后才公开。
          领取前请确认产品官方的适用条件和规则，邀请码有效期以官方为准。
        </div>
      </main>

      <Footer />

      <DetailModal invite={detail} onClose={() => setDetail(null)} />
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
