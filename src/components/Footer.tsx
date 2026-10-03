import { isSupabaseConfigured } from "@/lib/supabase";

export default function Footer() {
  return (
    <footer className="border-t border-line py-6 text-center text-xs text-[#87928b]">
      <div className="container-page">
        开门 OpenDoor · 分享机会，也分享发现
        <span className="mx-2 text-line">|</span>
        {isSupabaseConfigured ? "已连接 Supabase" : "本地演示模式（未配置 Supabase）"}
      </div>
    </footer>
  );
}
