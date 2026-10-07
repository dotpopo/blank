import { Link } from "react-router-dom";
import { Button } from "../components/ui";

/** 还没做的页面。不假装做好了, 直接说清这块要干什么 */
export default function Stub({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-[60ch] py-20">
      <h1 className="text-2xl font-medium tracking-tight text-ink-strong">{title}</h1>
      <div className="mt-4 text-sm leading-relaxed text-dim">{children}</div>
      <Link to="/" className="mt-8 inline-block no-underline">
        <Button variant="ghost">回到首页</Button>
      </Link>
    </section>
  );
}
