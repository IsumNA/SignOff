import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Lock, ShieldAlert } from "lucide-react";
import { getAudit, getMatters, type AuditRecord, type Matter } from "@/lib/api";
import { Brand } from "@/components/Brand";
import {
  DocumentFold,
  ReviewGlass,
  Seal,
  SignatureLine,
} from "@/components/icons";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "SignOff — Audit trail" },
      {
        name: "description",
        content:
          "Tamper-evident, hash-chained record of every supervised decision across the portfolio.",
      },
    ],
  }),
  component: AuditTrail,
});

const TYPE_META: Record<
  string,
  { color: string; Icon: typeof Seal; label: string }
> = {
  signoff: { color: "var(--color-foreground)", Icon: SignatureLine, label: "Sign-off" },
  analysis: { color: "var(--color-muted-foreground)", Icon: ReviewGlass, label: "Analysis" },
  matter_planned: { color: "var(--color-muted-foreground)", Icon: DocumentFold, label: "Planned" },
};

function AuditTrail() {
  const [events, setEvents] = useState<AuditRecord[]>([]);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getAudit(undefined, 500), getMatters()])
      .then(([a, m]) => {
        setEvents(a.events);
        setVerified(a.verified);
        setCount(a.count);
        setStats(a.stats.by_type ?? {});
        setMatters(m.matters);
      })
      .catch(() => setVerified(null))
      .finally(() => setLoading(false));
  }, []);

  const matterName = (id: string | null) =>
    id ? matters.find((m) => m.id === id)?.name ?? id : "—";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/60 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Brand />
          <span className="h-4 w-px bg-border" />
          <span className="truncate text-[13px] font-medium text-muted-foreground">
            Audit trail
          </span>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to ledger
        </Link>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-serif text-[32px] font-medium leading-tight tracking-[-0.02em]">
                Decision record
              </h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                Every analysis, plan and sign-off across the portfolio, written to an
                append-only log. Each entry seals the hash of the one before it, so any
                later edit or deletion is detectable.
              </p>
            </div>
            {verified !== null && (
              <span
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold"
                style={{
                  color: verified ? "var(--color-foreground)" : "var(--color-destructive)",
                  backgroundColor: `color-mix(in oklab, ${verified ? "var(--color-foreground)" : "var(--color-destructive)"} 12%, transparent)`,
                }}
                title="The server recomputes the SHA-256 hash chain on every read."
              >
                {verified ? <Seal className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                {verified ? "Hash chain verified" : "Chain integrity broken"}
              </span>
            )}
          </div>

          {/* Stat strip */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Total records", value: count },
              { label: "Sign-offs", value: stats.signoff ?? 0 },
              { label: "Analyses", value: stats.analysis ?? 0 },
              { label: "Matters planned", value: stats.matter_planned ?? 0 },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-surface/40 px-4 py-3">
                <p className="text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{s.label}</p>
                <p className="mt-1.5 font-serif text-[26px] font-medium tabular-nums leading-none">{s.value}</p>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-12 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the chain…
            </div>
          ) : events.length === 0 ? (
            <p className="py-12 text-[13px] text-muted-foreground">
              No records yet. Plan a matter or sign off a clause to start the trail.
            </p>
          ) : (
            <ol className="space-y-2">
              {events.map((e) => {
                const meta = TYPE_META[e.type] ?? TYPE_META.analysis;
                const { Icon } = meta;
                return (
                  <li
                    key={e.id}
                    className="rounded-xl border border-white/[0.06] bg-card/50 px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          color: meta.color,
                          backgroundColor: `color-mix(in oklab, ${meta.color} 14%, transparent)`,
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">#{e.seq}</span>
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: meta.color, backgroundColor: `color-mix(in oklab, ${meta.color} 12%, transparent)` }}
                          >
                            {meta.label}
                          </span>
                          <span className="text-[13px] font-medium text-foreground">{e.summary}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <span>
                            Matter:{" "}
                            {e.matter_id ? (
                              <Link
                                to="/matter/$matterId"
                                params={{ matterId: e.matter_id }}
                                className="text-[color:var(--color-info)] hover:underline"
                              >
                                {matterName(e.matter_id)}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </span>
                          <span>By {e.actor}</span>
                          <span className="font-mono">{new Date(e.timestamp).toLocaleString()}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
                          <Lock className="h-3 w-3" />
                          <span title={`hash ${e.hash}`}>{e.hash.slice(0, 12)}</span>
                          <span className="opacity-50">←</span>
                          <span title={`prev ${e.prev_hash}`}>{e.prev_hash.slice(0, 12)}</span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
