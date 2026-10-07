import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { pool, PoolError } from "../data";
import { contributeInputSchema, submitAppInputSchema } from "../types/domain";
import type { App, Quota } from "../types/domain";
import { Button, Callout, Field, Tag, TextInput } from "../components/ui";

function errorText(err: unknown): string {
  if (err instanceof PoolError) return err.message;
  if (err instanceof Error) return err.message;
  return "出了点问题，再试一次";
}

export default function Contribute() {
  const [apps, setApps] = useState<App[]>([]);
  const [appId, setAppId] = useState("");
  const [code, setCode] = useState("");
  const [ttl, setTtl] = useState("");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 新分类
  const [newName, setNewName] = useState("");
  const [newTtl, setNewTtl] = useState("14");
  const [appBusy, setAppBusy] = useState(false);
  const [appDone, setAppDone] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    pool.apps().then((list) => {
      setApps(list);
      if (list.length) {
        setAppId(list[0].id);
        setTtl(String(list[0].defaultTtlDays));
      }
    });
  }, []);

  const selected = apps.find((a) => a.id === appId);

  useEffect(() => {
    if (!appId) return;
    let alive = true;
    pool
      .quota(appId)
      .then((q) => alive && setQuota(q))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [appId]);

  async function onContribute(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);

    const parsed = contributeInputSchema.safeParse({
      appId,
      code,
      ttlDays: ttl ? Number(ttl) : undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "填的内容有问题");
      return;
    }

    setBusy(true);
    try {
      await pool.contribute(parsed.data);
      setDone(`已经放进「${selected?.name}」的池子，别人现在能领到它了。`);
      setCode("");
      setQuota(await pool.quota(appId));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitApp(e: React.FormEvent) {
    e.preventDefault();
    setAppError(null);
    const parsed = submitAppInputSchema.safeParse({ name: newName, ttlDays: Number(newTtl) });
    if (!parsed.success) {
      setAppError(parsed.error.issues[0]?.message ?? "填的内容有问题");
      return;
    }
    setAppBusy(true);
    try {
      await pool.submitApp(parsed.data);
      setAppDone(true);
      setNewName("");
    } catch (err) {
      setAppError(errorText(err));
    } finally {
      setAppBusy(false);
    }
  }

  return (
    <div className="max-w-[620px] py-14">
      <h1 className="text-3xl font-medium leading-tight tracking-tight text-ink-strong">
        把富余的码放进来
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-dim">
        放进来之后它立刻就能被别人领走。同一个应用分类下，同一串码只收一次。
      </p>

      <form onSubmit={onContribute} className="mt-8 flex flex-col gap-5">
        <Field label="放到哪个应用分类" hint={selected ? `这个分类的默认有效期是 ${selected.defaultTtlDays} 天` : undefined}>
          <div className="relative">
            <select
              value={appId}
              onChange={(e) => {
                setAppId(e.target.value);
                const next = apps.find((a) => a.id === e.target.value);
                if (next) setTtl(String(next.defaultTtlDays));
              }}
              className="w-full appearance-none rounded-control border border-line bg-surface px-3 py-2.5 pr-10 text-sm text-ink-strong transition-colors duration-150 ease-out hover:border-line-strong"
            >
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={16}
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-dim"
            />
          </div>
        </Field>

        <Field label="邀请码" hint="前后空格和连字符会被忽略，大小写不敏感">
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="例如 MF-4K9T-2XQ8"
            data-testid="contribute-code"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>

        <Field label="有效期（天）" hint="留空就用这个分类的默认值">
          <TextInput
            value={ttl}
            onChange={(e) => setTtl(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="nums w-32 font-mono"
          />
        </Field>

        {quota && (
          <p data-testid="quota-line" className="nums text-sm text-dim">
            这个分类今天还能放 {quota.contributeLeft} 次
          </p>
        )}

        {error && (
          <div data-testid="contribute-error">
            <Callout tone="danger" title="没能放进去">{error}</Callout>
          </div>
        )}
        {done && (
          <div data-testid="contribute-result">
            <Callout tone="neutral" title="放进去了">{done}</Callout>
          </div>
        )}

        <div>
          <Button type="submit" busy={busy} disabled={!apps.length}>
            放进池子
          </Button>
        </div>
      </form>

      <section className="mt-16 border-t border-line pt-8">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium tracking-tight text-ink-strong">没有你要的分类</h2>
          <Tag tone="neutral">需要审批</Tag>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-dim">
          提交一个新分类，管理员审过之后它才会出现在首页的筛选里。新分类不会自动带上任何邀请码。
        </p>

        {appDone ? (
          <div className="mt-6" data-testid="submit-app-result">
            <Callout tone="neutral" title="已经提交">
              等管理员审批。通过之后它就会出现在首页的分类里。
            </Callout>
          </div>
        ) : (
          <form onSubmit={onSubmitApp} className="mt-6 flex flex-col gap-5">
            <Field label="应用名">
              <TextInput
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如 云栖笔记"
                data-testid="contribute-app-name"
              />
            </Field>
            <Field label="这个分类的邀请码有效期（天）">
              <TextInput
                value={newTtl}
                onChange={(e) => setNewTtl(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                className="nums w-32 font-mono"
              />
            </Field>
            {appError && <Callout tone="danger" title="没能提交">{appError}</Callout>}
            <div>
              <Button type="submit" variant="ghost" busy={appBusy}>
                提交待审
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
