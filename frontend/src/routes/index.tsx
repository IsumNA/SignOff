import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Cpu, Loader2, Network, Plus } from "lucide-react";
import {
  getHealth,
  getInsights,
  getMatters,
  type HealthResponse,
  type InsightPattern,
  type LedgerSummary,
  type Matter,
  type MatterStage,
  type MatterStatus,
  type PortfolioInsights,
} from "@/lib/api";
import { Brand } from "@/components/Brand";
import {
  DocumentFold,
  Gavel,
  ReviewGlass,
  Scales,
  Seal,
  SignatureLine,
  Workstreams,
} from "@/components/icons";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SignOff — Supervision" },
      {
        name: "description",
        content:
          "Supervise every active matter in one place: plan, coordinate, review and sign off.",
      },
    ],
  }),
  component: Ledger,
});

// ---------------------------------------------------------------------------
// Visual mappings
// ---------------------------------------------------------------------------

// Color restraint: red is reserved for things that block a partner. Everything
// else is neutral and differentiated by an actual legal icon, not a hue.
const STATUS_META: Record<
  MatterStatus,
  { color: string; Icon: typeof Gavel; label: string }
> = {
  review: { color: "var(--color-destructive)", Icon: Gavel, label: "Critical" },
  warning: { color: "var(--color-foreground)", Icon: Scales, label: "Warning" },
  escalate: { color: "var(--color-foreground)", Icon: Workstreams, label: "Escalation" },
  passed: { color: "var(--color-muted-foreground)", Icon: Seal, label: "Cleared" },
};

function envelopeColor(pct: number): string {
  // Breaching the envelope is a blocker → red. Otherwise stay neutral.
  return pct >= 80 ? "var(--color-foreground)" : "var(--color-destructive)";
}

const STAGE_ORDER: MatterStage[] = ["plan", "coordinate", "review", "signoff"];
const STAGE_LABEL: Record<MatterStage, string> = {
  plan: "Plan",
  coordinate: "Coordinate",
  review: "Review",
  signoff: "Sign Off",
};

function StageTrack({ stage }: { stage: MatterStage }) {
  const idx = STAGE_ORDER.indexOf(stage);
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-1">
        {STAGE_ORDER.map((s, i) => (
          <span
            key={s}
            className="h-0.5 w-4 rounded-full transition-colors"
            style={{
              background:
                i <= idx ? "var(--color-foreground)" : "var(--color-border-strong)",
            }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-foreground">{STAGE_LABEL[stage]}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function StatCell({
  Icon,
  label,
  value,
  danger = false,
  hint,
}: {
  Icon: typeof DocumentFold;
  label: string;
  value: string;
  danger?: boolean;
  hint?: string;
}) {
  const accent = danger ? "var(--color-destructive)" : "var(--color-muted-foreground)";
  return (
    <div className="flex items-center gap-3.5 px-6 py-3.5 sm:flex-1 sm:first:pl-0 sm:last:pr-0">
      <Icon className="h-4 w-4 shrink-0" style={{ color: accent }} />
      <div className="min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span
            className="font-serif text-[22px] font-medium leading-none tracking-tight tabular-nums"
            style={danger ? { color: "var(--color-destructive)" } : undefined}
          >
            {value}
          </span>
          {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

function AgentChips({ agents }: { agents: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {agents.map((a) => (
        <span
          key={a}
          className="inline-flex items-center rounded-md border border-border bg-surface-elevated/40 px-2 py-0.5 font-mono text-[10.5px] font-medium tracking-tight text-muted-foreground transition-colors group-hover:text-foreground"
        >
          {a}
        </span>
      ))}
    </div>
  );
}

function EnvelopeBar({ pct }: { pct: number }) {
  const color = envelopeColor(pct);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-muted/50">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[12px] font-semibold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

function BlockerPill({ blockers }: { blockers: Matter["blockers"] }) {
  if (blockers.count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <Seal className="h-3.5 w-3.5" />
        {blockers.label || "None"}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold"
      style={{
        color: "var(--color-destructive)",
        backgroundColor: "color-mix(in oklab, var(--color-destructive) 13%, transparent)",
      }}
    >
      <Gavel className="h-3.5 w-3.5" />
      {blockers.count} {blockers.label}
      <span className="font-mono opacity-70">· T{blockers.tier}</span>
    </span>
  );
}

const SEVERITY_COLOR: Record<InsightPattern["severity"], string> = {
  high: "var(--color-destructive)",
  medium: "var(--color-foreground)",
  low: "var(--color-muted-foreground)",
};

const SEVERITY_RANK: Record<InsightPattern["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

type MatterFlag = { title: string; severity: InsightPattern["severity"] };

// Per-row scrutiny marker — weaves the portfolio insight onto the actual matter
// it concerns, so attention lives on the matter rather than in a separate block.
function ScrutinyMark({ flags }: { flags: MatterFlag[] }) {
  const top = flags.reduce((a, b) =>
    SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a,
  );
  return (
    <span
      title={`Scrutinise — ${flags.map((f) => f.title).join(" · ")}`}
      className="inline-flex shrink-0 items-center"
    >
      <ReviewGlass className="h-3.5 w-3.5" style={{ color: SEVERITY_COLOR[top.severity] }} />
    </span>
  );
}

// Low-profile, collapsed-by-default strip. Keeps the matter ledger as the focus
// while still surfacing the cross-matter (non-matter-specific) patterns on demand.
function ScrutinyStrip({ insights }: { insights: PortfolioInsights }) {
  const [open, setOpen] = useState(false);
  const count = insights.patterns.length;
  const hasHigh = insights.patterns.some((p) => p.severity === "high");
  const accent = hasHigh ? "var(--color-destructive)" : "var(--color-muted-foreground)";

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card/20 px-4 py-2 text-left transition hover:bg-accent/30"
      >
        <span className="flex items-center gap-2 text-[12px] font-medium text-foreground">
          <ReviewGlass className="h-3.5 w-3.5" style={{ color: accent }} />
          What to scrutinise
          <span
            className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{
              color: accent,
              backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)`,
            }}
          >
            {count}
          </span>
          <span className="hidden text-[11px] font-normal text-muted-foreground sm:inline">
            learned from {insights.learned_from.matters} matter
            {insights.learned_from.matters === 1 ? "" : "s"}
            {insights.learned_from.decisions > 0
              ? ` · ${insights.learned_from.decisions} decision${insights.learned_from.decisions === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-2 grid gap-2 rounded-lg border border-border bg-card/20 p-3 animate-reveal">
          {insights.patterns.map((p, i) => (
            <div key={i} className="flex items-start gap-3">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: SEVERITY_COLOR[p.severity] }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-foreground">{p.title}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{p.detail}</p>
              </div>
            </div>
          ))}
          {insights.benchmarks.length > 0 && (
            <div className="mt-1 border-t border-border pt-2">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Typical compliance by practice area
              </span>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {insights.benchmarks.map((b) => (
                  <span key={b.asset_class} className="text-[12px] text-muted-foreground">
                    {b.asset_class}{" "}
                    <span className="font-mono tabular-nums text-foreground">{b.avg_compliance}%</span>
                    <span className="opacity-60"> · {b.matters}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function Ledger() {
  const navigate = useNavigate();
  const [matters, setMatters] = useState<Matter[] | null>(null);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [insights, setInsights] = useState<PortfolioInsights | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getMatters()
      .then((r) => {
        setMatters(r.matters);
        setSummary(r.summary);
      })
      .catch(() => setError(true));
    getInsights().then(setInsights).catch(() => setInsights(null));
  }, []);

  const meshLive = health
    ? Object.values(health.integrations).some((v) => v === "live")
    : false;

  // Map each portfolio pattern onto the matter(s) it names, so scrutiny shows up
  // contextually on the relevant ledger row instead of in a separate block.
  const scrutinyByMatter = useMemo(() => {
    const map = new Map<string, MatterFlag[]>();
    if (!insights) return map;
    for (const p of insights.patterns) {
      for (const name of p.matters) {
        const list = map.get(name) ?? [];
        list.push({ title: p.title, severity: p.severity });
        map.set(name, list);
      }
    }
    return map;
  }, [insights]);

  function openMatter(m: Matter) {
    // Route to the matter's current lifecycle stage.
    if (m.stage === "plan" || m.stage === "coordinate") {
      navigate({ to: "/coordinate/$matterId", params: { matterId: m.id } });
    } else {
      navigate({ to: "/matter/$matterId", params: { matterId: m.id } });
    }
  }

  function openReview(m: Matter) {
    navigate({ to: "/matter/$matterId", params: { matterId: m.id } });
  }

  function openCoordinate(m: Matter) {
    navigate({ to: "/coordinate/$matterId", params: { matterId: m.id } });
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Topbar ── */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/60 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Brand />
          <span className="h-4 w-px bg-border" />
          <span className="truncate text-[13px] font-medium text-muted-foreground">
            Supervision
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/plan"
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New Matter
          </Link>
          <Link
            to="/audit"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            <Seal className="h-3.5 w-3.5" /> Audit trail
          </Link>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: meshLive ? "var(--color-success)" : "var(--color-warning)" }}
            />
            <Network className="h-3 w-3" />
            {health ? (meshLive ? "AI online" : "demo data") : "offline"}
          </span>
          <Link
            to="/profile"
            className="flex items-center gap-2 rounded-lg px-1 py-0.5 transition hover:bg-accent/40"
            title="Profile & settings"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-foreground">
              RC
            </span>
            <span className="hidden sm:block leading-tight">
              <span className="block text-[12px] font-semibold text-foreground">Clifford Chance</span>
              <span className="block text-[10px] text-muted-foreground">Rob Clay · M&amp;A Partner</span>
            </span>
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-6xl px-6 py-8">
          {/* Title */}
          <div className="mb-8 mt-2">
            <h1 className="font-serif text-[34px] font-medium leading-[1.1] tracking-[-0.02em]">
              Matters
            </h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Every matter you supervise, the stage it has reached, and what is waiting on
              your review and sign-off.
            </p>
          </div>

          {/* Executive control strip — low-profile, high-density metric bar */}
          <div className="mb-9 flex flex-col border-y border-border divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
            <StatCell
              Icon={DocumentFold}
              label="Active Matters"
              value={summary ? String(summary.total_matters) : "—"}
            />
            <StatCell
              Icon={Gavel}
              label="Open Blockers"
              value={summary ? String(summary.total_blockers) : "—"}
              danger={!!summary && summary.total_blockers > 0}
              hint="pending review"
            />
            <StatCell
              Icon={Scales}
              label="Avg Compliance Score"
              value={summary ? `${summary.avg_envelope}%` : "—"}
            />
            <StatCell
              Icon={SignatureLine}
              label="Ready to Sign"
              value={summary ? String(summary.ready_to_sign) : "—"}
            />
          </div>

          {/* What to scrutinise — compact, collapsed by default so the matter
              ledger stays the focus; matter-specific flags appear on rows below. */}
          {insights && insights.patterns.length > 0 && (
            <ScrutinyStrip insights={insights} />
          )}

          {/* Ledger table */}
          <div className="overflow-hidden rounded-xl border border-border bg-card/30">
            <div className="grid grid-cols-[1.5fr_0.9fr_1.4fr_1.2fr_0.9fr_1.2fr_auto] items-center gap-4 border-b border-border bg-surface/60 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Active Matter</span>
              <span>Asset / Size</span>
              <span>AI Reviewers</span>
              <span>Lifecycle Stage</span>
              <span>Compliance</span>
              <span>Blockers Pending</span>
              <span className="text-right">Action</span>
            </div>

            {error ? (
              <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
                Couldn't reach the control tower. Is the backend running on{" "}
                <code className="font-mono">/api/matters</code>?
              </div>
            ) : !matters ? (
              <div className="flex items-center justify-center gap-2 px-5 py-12 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio…
              </div>
            ) : (
              matters.map((m) => {
                const sm = STATUS_META[m.status];
                const { Icon } = sm;
                const flags = scrutinyByMatter.get(m.name);
                return (
                  <div
                    key={m.id}
                    onClick={() => openMatter(m)}
                    className="group grid cursor-pointer grid-cols-[1.5fr_0.9fr_1.4fr_1.2fr_0.9fr_1.2fr_auto] items-center gap-4 border-b border-border/60 px-5 py-5 transition-colors last:border-0 hover:bg-accent/30"
                  >
                    {/* Matter */}
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{
                          backgroundColor: `color-mix(in oklab, ${sm.color} 16%, transparent)`,
                          color: sm.color,
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                          <span className="truncate">{m.name}</span>
                          {flags && flags.length > 0 && <ScrutinyMark flags={flags} />}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {m.client ?? sm.label}
                          {m.counterparty ? ` ⟶ ${m.counterparty}` : ""}
                        </span>
                      </div>
                    </div>

                    {/* Asset / size */}
                    <div className="min-w-0">
                      <span className="block truncate text-[12px] text-foreground">{m.asset_class}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{m.deal_size}</span>
                    </div>

                    {/* Agents */}
                    <AgentChips agents={m.agents_deployed} />

                    {/* Lifecycle stage */}
                    <StageTrack stage={m.stage} />

                    {/* Envelope */}
                    <EnvelopeBar pct={m.compliance_envelope} />

                    {/* Blockers */}
                    <div className="min-w-0">
                      <BlockerPill blockers={m.blockers} />
                    </div>

                    {/* Action — stage-aware */}
                    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      {m.action === "signoff" ? (
                        <button
                          onClick={() => openReview(m)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-1.5 text-[12px] font-semibold text-background transition hover:opacity-90"
                        >
                          <SignatureLine className="h-3.5 w-3.5" /> Sign Off Matter
                        </button>
                      ) : m.stage === "plan" || m.stage === "coordinate" ? (
                        <button
                          onClick={() => openCoordinate(m)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          <Workstreams className="h-3.5 w-3.5" /> Coordinate
                          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => openReview(m)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          Review Work
                          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footnote */}
          <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Cpu className="h-3.5 w-3.5" />
            Work carried out by a team of AI reviewers, kept within the risk limits you set, with
            a complete, tamper-proof record of every step.
          </div>
        </div>
      </main>
    </div>
  );
}
