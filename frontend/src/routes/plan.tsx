import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Cpu,
  Gauge,
  Loader2,
  Plus,
  Rocket,
  ShieldAlert,
  X,
} from "lucide-react";
import { createMatter } from "@/lib/api";
import { LifecycleStepper } from "@/components/Lifecycle";
import { Brand } from "@/components/Brand";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "SignOff — Plan a Matter" },
      {
        name: "description",
        content:
          "Define the supervision envelope and deploy autonomous agents onto a new matter.",
      },
    ],
  }),
  component: PlanMatter,
});

const ASSET_CLASSES = [
  "M&A",
  "Debt Financing",
  "Joint Venture",
  "Asset Purchase",
  "Regulatory Audit",
];
const JURISDICTIONS = ["English law", "Delaware law", "New York law", "EU"];
const SCOPE_OPTIONS = [
  "Purchase Price",
  "Covenants",
  "Material Adverse Change",
  "Data Protection",
  "Indemnities",
  "Confidentiality",
  "Governing Law",
];
const AGENT_OPTIONS: { name: string; role: string; color: string }[] = [
  { name: "Local NIM", role: "On-prem high-security risk", color: "var(--color-nvidia)" },
  { name: "Gemini 1.5 Pro", role: "Synthesis & decisioning", color: "var(--color-vertex)" },
  { name: "Perplexity", role: "Web-grounded research", color: "var(--color-deal)" },
  { name: "Claude 3.5 Sonnet", role: "Precedent drafting", color: "var(--color-deal)" },
];

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface-elevated/60 px-3 py-2 text-[13px] text-foreground outline-none transition focus:border-border-strong";

function Chip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
        active
          ? "border-transparent text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
      style={active ? { backgroundColor: `color-mix(in oklab, ${color ?? "var(--color-foreground)"} 16%, transparent)` } : undefined}
    >
      {color && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      )}
      {children}
    </button>
  );
}

function PlanMatter() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState(ASSET_CLASSES[0]);
  const [dealSize, setDealSize] = useState("");
  const [jurisdiction, setJurisdiction] = useState(JURISDICTIONS[0]);
  const [envelope, setEnvelope] = useState(95);
  const [escalationTier, setEscalationTier] = useState(3);
  const [scope, setScope] = useState<string[]>(["Indemnities", "Material Adverse Change"]);
  const [agents, setAgents] = useState<string[]>(["Local NIM", "Gemini 1.5 Pro"]);
  const [redlines, setRedlines] = useState<string[]>([
    "No uncapped indemnities without partner sign-off",
  ]);
  const [redlineDraft, setRedlineDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function addRedline() {
    const v = redlineDraft.trim();
    if (v && !redlines.includes(v)) setRedlines([...redlines, v]);
    setRedlineDraft("");
  }

  async function deploy() {
    if (!name.trim()) {
      setError("Give the matter a name first.");
      return;
    }
    if (agents.length === 0) {
      setError("Deploy at least one agent.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const m = await createMatter({
        name: name.trim(),
        asset_class: assetClass,
        deal_size: dealSize.trim() || "—",
        jurisdiction,
        agents_deployed: agents,
        scope,
        redlines,
        envelope_target: envelope,
        escalation_tier: escalationTier,
      });
      navigate({ to: "/coordinate/$matterId", params: { matterId: m.id } });
    } catch {
      setError("Couldn't create the matter. Is the backend running?");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Topbar */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/60 px-6 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/" className="min-w-0">
            <Brand />
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-[13px] font-medium text-muted-foreground">Plan a matter</span>
        </div>
        <LifecycleStepper current="plan" compact />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <Link
            to="/"
            className="mb-5 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to ledger
          </Link>

          <div className="mb-7">
            <h1 className="text-xl font-bold tracking-tight">Plan a New Matter</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Stage 1 of supervision. Define the deterministic risk envelope the agents must
              operate inside, then deploy them. Nothing runs until you set the guardrails.
            </p>
          </div>

          <div className="grid gap-5">
            {/* Scope */}
            <section className="rounded-xl border border-border bg-card/30 p-5">
              <h2 className="mb-4 text-[13px] font-bold">Matter scope</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Matter name">
                  <input
                    className={inputCls}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Project Nova"
                    autoFocus
                  />
                </Field>
                <Field label="Asset class">
                  <select className={inputCls} value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
                    {ASSET_CLASSES.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Deal size">
                  <input
                    className={inputCls}
                    value={dealSize}
                    onChange={(e) => setDealSize(e.target.value)}
                    placeholder="e.g. $300M"
                  />
                </Field>
                <Field label="Governing law">
                  <select className={inputCls} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                    {JURISDICTIONS.map((j) => (
                      <option key={j} value={j}>{j}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            {/* Envelope */}
            <section className="rounded-xl border border-border bg-card/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-[color:var(--color-warning)]" />
                <h2 className="text-[13px] font-bold">Risk envelope</h2>
                <span className="text-[11px] text-muted-foreground">— the deterministic guardrails</span>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={`Compliance threshold — ${envelope}%`}>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={envelope}
                    onChange={(e) => setEnvelope(Number(e.target.value))}
                    className="w-full accent-[color:var(--color-warning)]"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Matters below this envelope are auto-flagged for partner review.
                  </span>
                </Field>
                <Field label="Auto-escalate at tier">
                  <div className="flex gap-2">
                    {[1, 2, 3].map((t) => (
                      <Chip key={t} active={escalationTier === t} onClick={() => setEscalationTier(t)}>
                        Tier {t}
                      </Chip>
                    ))}
                  </div>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Findings at or above this tier require human sign-off.
                  </span>
                </Field>
              </div>

              <div className="mt-5">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  In-scope clause categories
                </span>
                <div className="flex flex-wrap gap-2">
                  {SCOPE_OPTIONS.map((s) => (
                    <Chip key={s} active={scope.includes(s)} onClick={() => toggle(scope, setScope, s)}>
                      {s}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5" /> Hard red-lines (never auto-pass)
                </span>
                <div className="flex flex-wrap gap-2">
                  {redlines.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--color-destructive)]/40 bg-[color:var(--color-destructive)]/10 px-2.5 py-1.5 text-[12px] font-medium text-[color:var(--color-destructive)]"
                    >
                      {r}
                      <button type="button" onClick={() => setRedlines(redlines.filter((x) => x !== r))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className={inputCls}
                    value={redlineDraft}
                    onChange={(e) => setRedlineDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addRedline();
                      }
                    }}
                    placeholder="Add a hard red-line and press Enter"
                  />
                  <button
                    type="button"
                    onClick={addRedline}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-strong px-3 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </button>
                </div>
              </div>
            </section>

            {/* Agents */}
            <section className="rounded-xl border border-border bg-card/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Cpu className="h-4 w-4 text-[color:var(--color-vertex)]" />
                <h2 className="text-[13px] font-bold">Deploy agents</h2>
                <span className="text-[11px] text-muted-foreground">— the autonomous workforce, bounded by the envelope</span>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {AGENT_OPTIONS.map((a) => {
                  const active = agents.includes(a.name);
                  return (
                    <button
                      key={a.name}
                      type="button"
                      onClick={() => toggle(agents, setAgents, a.name)}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                        active ? "border-border-strong bg-surface-elevated/60" : "border-border hover:bg-accent/40"
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `color-mix(in oklab, ${a.color} 18%, transparent)` }}>
                        <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-foreground">{a.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{a.role}</span>
                      </span>
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-background ${active ? "border-transparent bg-foreground" : "border-border-strong"}`}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Footer / CTA */}
          <div className="mt-6 flex items-center justify-between gap-4">
            <span className="text-[12px] text-muted-foreground">
              {agents.length} agent{agents.length === 1 ? "" : "s"} · {scope.length} clause categories · {redlines.length} red-line{redlines.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-3">
              {error && <span className="text-[12px] text-[color:var(--color-destructive)]">{error}</span>}
              <button
                onClick={deploy}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Deploy agents &amp; open board
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
