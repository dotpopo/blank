import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Archive, Check, LogOut, Plus, X } from "lucide-react";
import {
  adminAvailable,
  createAdminSource,
  readSession,
  SessionExpired,
  writeSession,
  type AdminApp,
  type AdminCode,
  type AdminSession,
  type PendingApp,
} from "../data/admin";
import { PoolError } from "../data/seam";
import { Button, Callout, Chip, Field, Panel, Skeleton, Tag, TextInput } from "../components/ui";

/**
 * 管理后台。
 *
 * 设计原则是**队列优先**: 管理员每次进来大概率只做一件事, 处理待审分类。
 * 所以待审队列在第一屏, 而且能用键盘连续处理, 不用每次回鼠标。
 *
 * 决策 D-11: 管理员**不删除邀请码**。所以这里的码列表是只读的。
 * T09 工单原本写了「硬删除码」与「过期码批量硬删」, 与 D-11 冲突, 已按 D-11 改掉。
 */

const admin = createAdminSource();

function errorText(err: unknown): string {
  if (err instanceof SessionExpired) return err.message;
  if (err instanceof PoolError) return err.message;
  if (err instanceof Error) return err.message;
  return "操作没能完成";
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const hours = Math.round(diff / 36e5);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- 登录 ---------- */

function LoginCard({ onDone }: { onDone: (session: AdminSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[420px] py-20">
      <h1 data-testid="admin-title" className="text-2xl font-medium tracking-tight text-ink-strong">管理员登录</h1>
      <p className="mt-3 text-sm leading-relaxed text-dim">
        固定账号，不开放注册。口令在数据库里以 bcrypt 哈希保存，登录失败时不会告诉你用户名到底存不存在。
      </p>

      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const session = await admin.login(username, password);
            writeSession(session);
            onDone(session);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="用户名">
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            data-testid="admin-username"
          />
        </Field>
        <Field label="密码">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            data-testid="admin-password"
          />
        </Field>

        {error && (
          <div data-testid="admin-login-error">
            <Callout tone="danger" title="没能登录">
              {error}
            </Callout>
          </div>
        )}

        <div>
          <Button type="submit" busy={busy} disabled={!username || !password}>
            登录
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ---------- 待审队列 ---------- */

function PendingQueue({
  token,
  items,
  onChanged,
  onExpired,
}: {
  token: string;
  items: PendingApp[];
  onChanged: () => Promise<void>;
  onExpired: () => void;
}) {
  const [active, setActive] = useState(0);
  const [validity, setValidity] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const reasonRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const current = items[Math.min(active, Math.max(0, items.length - 1))];

  const act = useCallback(
    async (app: PendingApp, approve: boolean) => {
      const days = Number(validity[app.appId] ?? app.validityDays);
      const why = (reason[app.appId] ?? "").trim();

      if (approve && (!Number.isFinite(days) || days < 1 || days > 3650)) {
        setError("有效期要落在 1 到 3650 天之间");
        return;
      }
      if (!approve && !why) {
        setError("驳回要写理由，提交者要看得到");
        reasonRefs.current[app.appId]?.focus();
        return;
      }

      setBusy(app.appId);
      setError(null);
      try {
        await admin.reviewApp(token, app.appId, approve, approve ? days : undefined, approve ? undefined : why);
        setDone(approve ? `已通过「${app.name}」` : `已驳回「${app.name}」`);
        setActive((i) => Math.max(0, i - 1));
        await onChanged();
      } catch (err) {
        if (err instanceof SessionExpired) onExpired();
        else setError(errorText(err));
      } finally {
        setBusy(null);
      }
    },
    [token, validity, reason, onChanged, onExpired],
  );

  // 键盘连续处理。在输入框里打字时不抢键, 只留 Esc 收焦点
  function onKeyDown(e: React.KeyboardEvent) {
    const inField = (e.target as HTMLElement).tagName === "INPUT";
    if (inField) {
      if (e.key === "Escape") (e.target as HTMLElement).blur();
      return;
    }
    if (!current) return;

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void act(current, true);
    } else if (e.key === "r" || e.key === "Backspace") {
      e.preventDefault();
      reasonRefs.current[current.appId]?.focus();
    }
  }

  return (
    <section aria-label="待审队列" data-testid="pending-queue" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium tracking-tight text-ink-strong">
          待审队列
          {items.length > 0 && <span className="nums ml-2 text-dim">{items.length}</span>}
        </h2>
        <p className="text-xs text-dim">
          ↑ ↓ 换条目　Enter 通过　r 去写驳回理由
        </p>
      </div>

      {error && (
        <div className="mt-4">
          <Callout tone="danger" title="没能处理">
            {error}
          </Callout>
        </div>
      )}
      {done && (
        <div className="mt-4">
          <Callout tone="neutral" title={done}>
            队列已刷新。
          </Callout>
        </div>
      )}

      {items.length === 0 ? (
        <Panel className="mt-5 px-6 py-12 text-center">
          <p className="text-sm text-ink-strong">队列是空的</p>
          <p className="mt-2 text-sm text-dim">没有待审的分类，说明没人提交，或者你都处理完了。</p>
        </Panel>
      ) : (
        <div
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="mt-5 flex flex-col gap-3 rounded-panel outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          {items.map((app, index) => {
            const isActive = index === Math.min(active, items.length - 1);
            return (
              <motion.div
                key={app.appId}
                layout
                data-testid={`pending-${app.name}`}
                onMouseEnter={() => setActive(index)}
                className={
                  "rounded-panel border p-5 transition-colors duration-150 ease-out " +
                  (isActive ? "border-accent-line bg-accent-tint" : "border-line bg-surface")
                }
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-base font-medium text-ink-strong">{app.name}</span>
                  <Tag tone="neutral">{app.category}</Tag>
                  <span className="text-xs text-dim">{relative(app.submittedAt)}提交</span>
                  {app.codeCount > 0 && (
                    <Tag tone="accent">带了 {app.codeCount} 个码</Tag>
                  )}
                </div>

                {app.description && (
                  <p className="mt-3 text-sm leading-relaxed text-dim">{app.description}</p>
                )}
                {app.url && (
                  <p className="mt-2 text-xs text-dim">
                    官网{" "}
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-line-strong underline-offset-4 hover:text-ink"
                    >
                      {app.url}
                    </a>
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink">
                    <span>有效期</span>
                    <TextInput
                      value={validity[app.appId] ?? String(app.validityDays)}
                      onChange={(e) =>
                        setValidity((prev) => ({
                          ...prev,
                          [app.appId]: e.target.value.replace(/[^\d]/g, ""),
                        }))
                      }
                      inputMode="numeric"
                      className="nums w-20 font-mono"
                    />
                    <span>天</span>
                  </label>

                  <Button busy={busy === app.appId} onClick={() => void act(app, true)}>
                    <Check size={15} aria-hidden />
                    通过
                  </Button>

                  <div className="flex min-w-[220px] flex-1 items-end gap-2">
                    <TextInput
                      ref={(el) => {
                        reasonRefs.current[app.appId] = el;
                      }}
                      value={reason[app.appId] ?? ""}
                      onChange={(e) =>
                        setReason((prev) => ({ ...prev, [app.appId]: e.target.value }))
                      }
                      placeholder="驳回理由，提交者看得到"
                      aria-label={`驳回「${app.name}」的理由`}
                      className="flex-1"
                    />
                    <Button variant="ghost" onClick={() => void act(app, false)}>
                      <X size={15} aria-hidden />
                      驳回
                    </Button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- 有效期单元格 ---------- */

/**
 * 有效期是可改的，而且改它是有副作用的：池子里那些「到期时间跟随应用默认值」的码，
 * 到期时间会跟着重算。所以保存之后要把影响条数说出来，不能悄悄改完就走。
 */
function ValidityCell({
  app,
  token,
  onSaved,
  onExpired,
  onError,
}: {
  app: AdminApp;
  token: string;
  onSaved: (message: string) => Promise<void>;
  onExpired: () => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(String(app.validityDays));
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(String(app.validityDays)), [app.validityDays]);

  const dirty = value !== String(app.validityDays) && value !== "";

  return (
    <div className="flex items-center gap-2">
      <TextInput
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
        inputMode="numeric"
        disabled={app.status !== "approved"}
        aria-label={`「${app.name}」的有效期天数`}
        className="nums w-16 px-2 py-1 text-center font-mono text-xs"
      />
      <span className="text-xs text-dim">天</span>
      {dirty && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await admin.setAppValidity(token, app.appId, Number(value));
              await onSaved(
                `「${app.name}」的有效期从 ${result.oldValidityDays} 天改成 ${Number(value)} 天` +
                  (result.affectedCodes
                    ? `，池子里 ${result.affectedCodes} 个码的到期时间跟着改了`
                    : "，池子里没有需要跟着改的码"),
              );
            } catch (err) {
              if (err instanceof SessionExpired) onExpired();
              else onError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
          className="whitespace-nowrap rounded-control border border-accent-line px-2 py-1 text-xs text-accent-ink transition-colors duration-150 ease-out hover:bg-accent-tint"
        >
          保存
        </button>
      )}
    </div>
  );
}

/* ---------- 有效期单元格 ---------- */


/* ---------- 分类管理 ---------- */

function AppsPanel({
  token,
  onExpired,
}: {
  token: string;
  onExpired: () => void;
}) {
  const [apps, setApps] = useState<AdminApp[] | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApps(await admin.apps(token));
    } catch (err) {
      if (err instanceof SessionExpired) onExpired();
      else setError(errorText(err));
    }
  }, [token, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="分类管理" data-testid="apps-panel" className="mt-14">
      <h2 className="text-lg font-medium tracking-tight text-ink-strong">分类管理</h2>
      <p className="mt-2 text-sm leading-relaxed text-dim">
        管理员可以新增分类、下架分类、审批别人提交的分类。下架是归档而不是物理删除：
        它下面的码和大盘流水都要留着，否则趋势图会断。
      </p>

      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setNotice(null);
          try {
            await admin.addApp(token, name.trim(), category.trim() || "其他", Number(days));
            setNotice(`已新增「${name.trim()}」`);
            setName("");
            await load();
          } catch (err) {
            if (err instanceof SessionExpired) onExpired();
            else setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="应用名">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 云栖笔记"
            data-testid="admin-new-app-name"
          />
        </Field>
        <Field label="分类">
          <TextInput
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="其他"
            className="w-32"
          />
        </Field>
        <Field label="有效期（天）">
          <TextInput
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="nums w-24 font-mono"
          />
        </Field>
        <Button type="submit" busy={busy} disabled={!name.trim()}>
          <Plus size={15} aria-hidden />
          新增
        </Button>
      </form>

      {error && (
        <div className="mt-4">
          <Callout tone="danger" title="没能完成">
            {error}
          </Callout>
        </div>
      )}
      {notice && (
        <div className="mt-4">
          <Callout tone="neutral" title={notice}>
            列表已刷新。
          </Callout>
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        {apps === null ? (
          <Skeleton className="h-40 rounded-panel" />
        ) : apps.length === 0 ? (
          <p className="text-sm text-dim">还没有分类。</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-dim">
                <th className="border-b border-line pb-2 pr-4 font-normal">名称</th>
                <th className="border-b border-line pb-2 pr-4 font-normal">分类</th>
                <th className="border-b border-line pb-2 pr-4 font-normal">状态</th>
                <th className="border-b border-line pb-2 pr-4 font-normal">有效期</th>
                <th className="border-b border-line pb-2 pr-4 font-normal">可领</th>
                <th className="border-b border-line pb-2 pr-4 font-normal">已领</th>
                <th className="border-b border-line pb-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr key={app.appId} className="text-ink">
                  <td className="border-b border-line py-2.5 pr-4 text-ink-strong">{app.name}</td>
                  <td className="border-b border-line py-2.5 pr-4 text-dim">{app.category}</td>
                  <td className="border-b border-line py-2.5 pr-4">
                    {app.status === "approved" ? (
                      <Tag tone="accent">在用</Tag>
                    ) : app.status === "archived" ? (
                      <Tag tone="neutral">已归档</Tag>
                    ) : app.status === "rejected" ? (
                      <Tag tone="danger">已驳回</Tag>
                    ) : (
                      <Tag tone="warn">待审</Tag>
                    )}
                  </td>
                  <td className="border-b border-line py-2 pr-4">
                    <ValidityCell
                      app={app}
                      token={token}
                      onSaved={async (message) => {
                        setNotice(message);
                        await load();
                      }}
                      onExpired={onExpired}
                      onError={setError}
                    />
                  </td>
                  <td className="nums border-b border-line py-2.5 pr-4 text-dim">
                    {app.availableCodes}
                  </td>
                  <td className="nums border-b border-line py-2.5 pr-4 text-dim">
                    {app.claimedCodes}
                  </td>
                  <td className="border-b border-line py-2.5 text-right">
                    {app.status === "approved" && (
                      <button
                        type="button"
                        onClick={async () => {
                          setError(null);
                          try {
                            const result = await admin.removeApp(token, app.appId);
                            setNotice(
                              `已归档「${app.name}」` +
                                (result.abandonedCodes
                                  ? `，它下面 ${result.abandonedCodes} 个可领的码一并作废`
                                  : ""),
                            );
                            await load();
                          } catch (err) {
                            if (err instanceof SessionExpired) onExpired();
                            else setError(errorText(err));
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-xs text-dim transition-colors duration-150 ease-out hover:border-line-strong hover:text-ink"
                      >
                        <Archive size={13} aria-hidden />
                        下架
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ---------- 码（只读） ---------- */

function CodesPanel({ token, onExpired }: { token: string; onExpired: () => void }) {
  const [codes, setCodes] = useState<AdminCode[] | null>(null);
  const [status, setStatus] = useState<string>("available");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCodes(await admin.codes(token, undefined, status));
    } catch (err) {
      if (err instanceof SessionExpired) onExpired();
      else setError(errorText(err));
    }
  }, [token, status, onExpired]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const code of codes ?? []) map.set(code.appName, (map.get(code.appName) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [codes]);

  return (
    <section aria-label="邀请码" data-testid="codes-panel" className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-medium tracking-tight text-ink-strong">邀请码</h2>
        <p className="text-xs text-dim">只读。管理员不删邀请码（决策 D-11）</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          ["available", "可领"],
          ["claimed", "已领"],
          ["removed", "已移除"],
        ].map(([value, label]) => (
          <Chip key={value} active={status === value} onClick={() => setStatus(value)}>
            {label}
          </Chip>
        ))}
      </div>

      {error && (
        <div className="mt-4">
          <Callout tone="danger" title="没能读到码">
            {error}
          </Callout>
        </div>
      )}

      {codes === null ? (
        <Skeleton className="mt-5 h-40 rounded-panel" />
      ) : codes.length === 0 ? (
        <p className="mt-5 text-sm text-dim">这个状态下没有码。</p>
      ) : (
        <>
          <p className="mt-5 text-xs text-dim">
            共 {codes.length} 条，分布在 {counts.length} 个分类
          </p>
          <div className="mt-3 max-h-[420px] overflow-auto rounded-panel border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-xs text-dim">
                  <th className="border-b border-line px-4 py-2 font-normal">分类</th>
                  <th className="border-b border-line px-4 py-2 font-normal">码（预览）</th>
                  <th className="border-b border-line px-4 py-2 font-normal">状态</th>
                  <th className="border-b border-line px-4 py-2 font-normal">到期</th>
                  <th className="border-b border-line px-4 py-2 font-normal">入池</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr key={code.codeId} className="text-ink">
                    <td className="border-b border-line px-4 py-2 text-ink-strong">{code.appName}</td>
                    <td className="border-b border-line px-4 py-2 font-mono text-xs text-dim">
                      {code.codePreview}
                    </td>
                    <td className="border-b border-line px-4 py-2 text-dim">{code.status}</td>
                    <td className="nums border-b border-line px-4 py-2 text-dim">
                      {shortDate(code.expiresAt)}
                    </td>
                    <td className="nums border-b border-line px-4 py-2 text-dim">
                      {shortDate(code.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- 页面 ---------- */

export default function Admin() {
  const [session, setSession] = useState<AdminSession | null>(() => readSession());
  const [pending, setPending] = useState<PendingApp[] | null>(null);
  const [expired, setExpired] = useState(false);

  const onExpired = useCallback(() => {
    writeSession(null);
    setSession(null);
    setExpired(true);
  }, []);

  const loadPending = useCallback(async () => {
    if (!session) return;
    try {
      setPending(await admin.pendingApps(session.token));
    } catch (err) {
      if (err instanceof SessionExpired) onExpired();
    }
  }, [session, onExpired]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  if (!adminAvailable) {
    return (
      <div className="max-w-[60ch] py-20">
        <h1 data-testid="admin-title" className="text-2xl font-medium tracking-tight text-ink-strong">管理员后台</h1>
        <span data-testid="admin-demo-notice" className="sr-only">演示数据源下后台不可用</span>
        <div className="mt-5">
          <Callout tone="neutral" title="当前是演示数据源，后台不可用">
            后台需要服务端来校验口令、保存会话。演示数据源只活在浏览器里，没有服务端，
            做一个「跳过登录的后台」等于把权限做成摆设，所以这里不做。
            <br />
            接上真实数据库（配好 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY）之后，这个页面就是完整的。
          </Callout>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div>
        {expired && (
          <div className="mx-auto mt-10 max-w-[420px]">
            <Callout tone="danger" title="登录已过期">
              会话失效了，请重新登录。
            </Callout>
          </div>
        )}
        <LoginCard onDone={setSession} />
      </div>
    );
  }

  return (
    <div className="pb-8 pt-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1
            data-testid="admin-title"
            className="text-3xl font-medium leading-tight tracking-tight text-ink-strong"
          >
            管理后台
          </h1>
          <p className="nums mt-2 text-sm text-dim">
            已登录：{session.username}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              await admin.logout(session.token);
            } catch {
              /* 退出失败也要把本地会话清掉, 否则会卡在已登录状态 */
            }
            writeSession(null);
            setSession(null);
          }}
        >
          <LogOut size={15} aria-hidden />
          退出
        </Button>
      </div>

      {pending === null ? (
        <Skeleton className="mt-10 h-40 rounded-panel" />
      ) : (
        <PendingQueue
          token={session.token}
          items={pending}
          onChanged={loadPending}
          onExpired={onExpired}
        />
      )}

      <AppsPanel token={session.token} onExpired={onExpired} />
      <CodesPanel token={session.token} onExpired={onExpired} />
    </div>
  );
}
