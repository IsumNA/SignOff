import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileSignature,
  Gauge,
  Layers,
  Loader2,
  Network,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  getHealth,
  getMatters,
  type HealthResponse,
  type LedgerSummary,
  type Matter,
  type MatterStage,
  type MatterStatus,
} from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SignOff — Oversight Control Tower" },
      {
        name: "description",
        content:
          "Supervise dozens of automated legal workstreams across every active matter from one command center.",
      },
    ],
  }),
  component: Ledger,
});

// ---------------------------------------------------------------------------
// Visual mappings
// ---------------------------------------------------------------------------

const STATUS_META: Record<
  MatterStatus,
  { color: string; Icon: typeof ShieldCheck; label: string }
> = {
  review: { color: "var(--color-destructive)", Icon: AlertOctagon, label: "Critical" },
  warning: { color: "var(--color-warning)", Icon: AlertTriangle, label: "Warning" },
  escalate: { color: "var(--color-info)", Icon: Users, label: "Escalation" },
  passed: { color: "var(--color-success)", Icon: ShieldCheck, label: "Cleared" },
};

function tierColor(tier: number): string {
  if (tier >= 3) return "var(--color-destructive)";
  if (tier === 2) return "var(--color-warning)";
  return "var(--color-success)";
}

function envelopeColor(pct: number): string {
  if (pct >= 95) return "var(--color-success)";
  if (pct >= 80) return "var(--color-warning)";
  return "var(--color-destructive)";
}

const AGENT_DOT: { match: string[]; color: string }[] = [
  { match: ["nim", "llama"], color: "var(--color-nvidia)" },
  { match: ["gemini", "vertex"], color: "var(--color-vertex)" },
  { match: ["claude", "gpt", "harvey", "perplexity"], color: "var(--color-deal)" },
];

function agentColor(name: string): string {
  const n = name.toLowerCase();
  for (const a of AGENT_DOT) if (a.match.some((m) => n.includes(m))) return a.color;
  return "var(--color-muted-foreground)";
}

const STAGE_ORDER: MatterStage[] = ["plan", "coordinate", "review", "signoff"];
const STAGE_LABEL: Record<MatterStage, string> = {
  plan: "Plan",
  coordinate: "Coordinate",
  review: "Review",
  signoff: "Sign Off",
};

function StageDots({ stage }: { stage: MatterStage }) {
  const idx = STAGE_ORDER.indexOf(stage);
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {STAGE_ORDER.map((s, i) => (
          <span
            key={s}
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background:
                i < idx
                  ? "var(--color-success)"
                  : i === idx
                    ? "var(--color-foreground)"
                    : "var(--color-border-strong)",
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

function SummaryCard({
  Icon,
  label,
  value,
  accent,
  hint,
}: {
  Icon: typeof Gauge;
  label: string;
  value: string;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-border bg-card/50 px-4 py-3.5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `color-mix(in oklab, ${accent} 16%, transparent)`, color: accent }}
      >
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold tracking-tight text-foreground">{value}</span>
          {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
        <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
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
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-elevated/60 px-2 py-0.5 text-[11px] font-medium text-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: agentColor(a) }} />
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
      <div className="h-1.5 w-full max-w-[120px] overflow-hidden rounded-full bg-muted/50">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[12px] font-semibold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

function BlockerPill({
  blockers,
}: {
  blockers: Matter["blockers"];
}) {
  if (blockers.count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--color-success)]">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {blockers.label || "None"}
      </span>
    );
  }
  const color = tierColor(blockers.tier);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {blockers.count} {blockers.label}
      <span className="font-mono opacity-70">· T{blockers.tier}</span>
    </span>
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
  const [error, setError] = useState(false);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getMatters()
      .then((r) => {
        setMatters(r.matters);
        setSummary(r.summary);
      })
      .catch(() => setError(true));
  }, []);

  const meshLive = health
    ? Object.values(health.integrations).some((v) => v === "live")
    : false;

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
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
            <FileSignature className="h-4 w-4" />
          </span>
          <span className="text-sm font-bold tracking-tight">SignOff</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-muted-foreground">
            Oversight Control Tower
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/plan"
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New Matter
          </Link>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: meshLive ? "var(--color-success)" : "var(--color-warning)" }}
            />
            <Network className="h-3 w-3" />
            {health ? (meshLive ? "mesh online" : "demo mode") : "offline"}
          </span>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-foreground">
              LC
            </span>
            <span className="hidden sm:block leading-tight">
              <span className="block text-[12px] font-semibold text-foreground">Northwind Legal</span>
              <span className="block text-[10px] text-muted-foreground">M&amp;A Partner</span>
            </span>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-6xl px-6 py-8">
          {/* Title */}
          <div className="mb-6">
            <h1 className="text-xl font-bold tracking-tight">Portfolio Risk Ledger</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Every active matter, the autonomous agents deployed on it, and the blockers awaiting
              your sign-off — one supervised risk envelope across the entire fleet.
            </p>
          </div>

          {/* Summary strip */}
          <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard
              Icon={Layers}
              label="Active Matters"
              value={summary ? String(summary.total_matters) : "—"}
              accent="var(--color-info)"
            />
            <SummaryCard
              Icon={AlertOctagon}
              label="Open Blockers"
              value={summary ? String(summary.total_blockers) : "—"}
              accent="var(--color-destructive)"
              hint="pending review"
            />
            <SummaryCard
              Icon={Gauge}
              label="Avg Compliance Envelope"
              value={summary ? `${summary.avg_envelope}%` : "—"}
              accent="var(--color-warning)"
            />
            <SummaryCard
              Icon={ShieldCheck}
              label="Ready to Sign"
              value={summary ? String(summary.ready_to_sign) : "—"}
              accent="var(--color-success)"
            />
          </div>

          {/* Ledger table */}
          <div className="overflow-hidden rounded-xl border border-border bg-card/30">
            <div className="grid grid-cols-[1.5fr_0.9fr_1.4fr_1.2fr_0.9fr_1.2fr_auto] items-center gap-4 border-b border-border bg-surface/60 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Active Matter</span>
              <span>Asset / Size</span>
              <span>Agents Deployed</span>
              <span>Lifecycle Stage</span>
              <span>Envelope</span>
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
                return (
                  <div
                    key={m.id}
                    onClick={() => openMatter(m)}
                    className="group grid cursor-pointer grid-cols-[1.5fr_0.9fr_1.4fr_1.2fr_0.9fr_1.2fr_auto] items-center gap-4 border-b border-border/60 px-5 py-4 transition-colors last:border-0 hover:bg-accent/40"
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
                        <span className="block truncate text-[13px] font-semibold text-foreground">
                          {m.name}
                        </span>
                        <span
                          className="text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: sm.color }}
                        >
                          {sm.label}
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
                    <StageDots stage={m.stage} />

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
                          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition hover:opacity-90"
                        >
                          <FileSignature className="h-3.5 w-3.5" /> Sign Off Matter
                        </button>
                      ) : m.stage === "plan" || m.stage === "coordinate" ? (
                        <button
                          onClick={() => openCoordinate(m)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        >
                          <Network className="h-3.5 w-3.5" /> Coordinate
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
            Autonomous workstreams executed by a multi-agent mesh, bounded by deterministic graph
            guardrails and an immutable Firestore audit trail.
          </div>
        </div>
      </main>
    </div>
  );
}
