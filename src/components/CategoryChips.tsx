import { CATEGORIES, type CategoryName } from "@/lib/invite-utils";

interface CategoryChipsProps {
  selected: CategoryName;
  onChange: (category: CategoryName) => void;
}

export default function CategoryChips({ selected, onChange }: CategoryChipsProps) {
  return (
    <div id="categories" className="flex flex-wrap justify-center gap-2.5">
      {CATEGORIES.map((category) => {
        const active = category === selected;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onChange(category)}
            aria-pressed={active}
            className={[
              "rounded-full border px-3.5 py-2 text-[13px] transition",
              active
                ? "border-brand bg-brand text-white"
                : "border-[#e6eae5] bg-white/70 text-[#58665e] hover:border-brand hover:text-brand",
            ].join(" ")}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}
