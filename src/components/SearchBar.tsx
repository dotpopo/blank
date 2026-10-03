interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export default function SearchBar({ value, onChange, onSubmit }: SearchBarProps) {
  return (
    <div className="mx-auto my-[30px] mb-[18px] flex w-full max-w-[610px] rounded-[14px] border border-[#e5eae4] bg-white p-1.5 shadow-soft">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        placeholder="搜索产品、邀请码或关键词…"
        aria-label="搜索"
        className="min-w-0 flex-1 border-0 bg-transparent px-3.5 text-sm text-ink outline-none placeholder:text-[#a0aaa3]"
      />
      <button
        type="button"
        onClick={onSubmit}
        className="rounded-[10px] bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
      >
        搜索
      </button>
    </div>
  );
}
