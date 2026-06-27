import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, Lightbulb, Loader2, Plus, X } from "lucide-react";
import { createMatter, getPlanSuggestion, type PlanSuggestion } from "@/lib/api";
import { LifecycleStepper } from "@/components/Lifecycle";
import { Brand } from "@/components/Brand";
import { Gavel, Scales, Workstreams } from "@/components/icons";

export const Route = createFileRoute("/plan")({
  head: () => ({
    meta: [
      { title: "SignOff — Plan a Matter" },
      {
        name: "description",
        content:
          "Set the risk limits for a new matter and choose which AI reviewers work on it.",
      },
    ],
  }),
  component: PlanMatter,
});

const ASSET_CLASSES = [
  "M&A / Antitrust",
  "Private Equity",
  "Leveraged Finance",
  "Equity Capital Markets",
  "Energy & Infrastructure",
  "Real Estate",
  "Funds",
];
const JURISDICTIONS = [
  "English law",
  "New York law",
  "Luxembourg law",
  "German law",
  "Italian law",
  "EU / cross-border",
];
const SCOPE_OPTIONS = [
  "Consideration & Completion Accounts",
  "Interim Covenants",
  "Material Adverse Change",
  "Data Protection",
  "Warranties & Indemnities",
  "Sanctions & ABC",
  "Merger Control & FDI",
  "Governing Law",
];
const AGENT_OPTIONS: { name: string; role: string }[] = [
  { name: "NVIDIA Nemotron", role: "Confidential risk review" },
  { name: "Gemini 2.5 Flash", role: "Analysis & recommendations" },
  { name: "Perplexity", role: "Live legal research" },
  { name: "Claude 3.5 Sonnet", role: "Precedent drafting" },
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
  const [client, setClient] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [dealSize, setDealSize] = useState("");
  const [jurisdiction, setJurisdiction] = useState(JURISDICTIONS[0]);
  const [envelope, setEnvelope] = useState(95);
  const [escalationTier, setEscalationTier] = useState(3);
  const [scope, setScope] = useState<string[]>([
    "Warranties & Indemnities",
    "Merger Control & FDI",
  ]);
  const [agents, setAgents] = useState<string[]>(["NVIDIA Nemotron", "Gemini 2.5 Flash"]);
  const [redlines, setRedlines] = useState<string[]>([
    "No uncapped indemnities without partner sign-off",
    "No remedies offered to competition authorities without partner approval",
  ]);
  const [redlineDraft, setRedlineDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Proactive, portfolio-learned setup suggestion for this practice area.
  const [suggestion, setSuggestion] = useState<PlanSuggestion | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    let live = true;
    setApplied(false);
    getPlanSuggestion(assetClass, jurisdiction)
      .then((s) => {
        if (live) setSuggestion(s);
      })
      .catch(() => {
        if (live) setSuggestion(null);
      });
    return () => {
      live = false;
    };
  }, [assetClass, jurisdiction]);

  function applySuggestion() {
    if (!suggestion) return;
    setEnvelope(suggestion.compliance_threshold);
    setEscalationTier(suggestion.escalation_tier);
    const validAgents = new Set(AGENT_OPTIONS.map((a) => a.name));
    setAgents(suggestion.reviewers.filter((r) => validAgents.has(r)));
    const validScope = new Set(SCOPE_OPTIONS);
    setScope(suggestion.scope.filter((s) => validScope.has(s)));
    setRedlines((prev) => {
      const merged = [...prev];
      for (const r of suggestion.redlines) if (!merged.includes(r)) merged.push(r);
      return merged;
    });
    setApplied(true);
  }

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
      setError("Select at least one AI reviewer.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const m = await createMatter({
        name: name.trim(),
        asset_class: assetClass,
        client: client.trim() || undefined,
        counterparty: counterparty.trim() || undefined,
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
          <Brand className="min-w-0" />
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

          <div className="mb-8">
            <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.02em]">
              Plan a New Matter
            </h1>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Stage 1 of supervision. Set the risk limits this matter must stay within, then
              choose your AI reviewers. Nothing runs until you set the limits.
            </p>
          </div>

          <div className="grid gap-5">
            {/* Proactive, portfolio-learned suggestion */}
            {suggestion && (
              <section className="rounded-xl border border-border-strong bg-surface-elevated/40 p-6 animate-reveal">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-strong text-foreground">
                      <Lightbulb className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-serif text-[18px] font-medium tracking-[-0.01em]">
                        Suggested setup for {suggestion.asset_class}
                      </h2>
                      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
                        {suggestion.rationale}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition hover:opacity-90"
                  >
                    {applied ? <Check className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}
                    {applied ? "Applied" : "Apply suggestion"}
                  </button>
                </div>

                {/* Confidence — grows as the portfolio learns from more matters */}
                <div className="mt-4 max-w-xs">
                  <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    <span>Confidence</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {Math.round(suggestion.confidence * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className="h-full rounded-full bg-foreground transition-all"
                      style={{ width: `${Math.round(suggestion.confidence * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    {suggestion.based_on > 0
                      ? `Learned from ${suggestion.based_on} comparable matter${suggestion.based_on === 1 ? "" : "s"} — sharpens as you plan more.`
                      : "Standard playbook — sharpens as you plan matters like this."}
                  </p>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recommended limits
                    </span>
                    <div className="flex flex-wrap gap-2 text-[12px]">
                      <span className="rounded-md border border-border bg-surface/60 px-2.5 py-1 text-foreground">
                        Compliance ≥ <span className="font-mono">{suggestion.compliance_threshold}%</span>
                      </span>
                      <span className="rounded-md border border-border bg-surface/60 px-2.5 py-1 text-foreground">
                        Escalate at Tier {suggestion.escalation_tier}
                      </span>
                    </div>
                    <span className="mt-3 mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Suggested reviewers
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestion.reviewers.map((r) => (
                        <span key={r} className="rounded-md border border-border bg-surface/60 px-2 py-0.5 text-[11px] text-foreground">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Gavel className="h-3.5 w-3.5" /> Likely risk hotspots
                    </span>
                    <ul className="space-y-1.5">
                      {suggestion.hotspots.map((h) => (
                        <li key={h.area} className="flex items-start gap-2 text-[12px] leading-snug">
                          <span
                            className="mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                            style={{
                              color: h.tier >= 3 ? "var(--color-destructive)" : "var(--color-muted-foreground)",
                              backgroundColor:
                                h.tier >= 3
                                  ? "color-mix(in oklab, var(--color-destructive) 14%, transparent)"
                                  : "var(--color-muted)",
                            }}
                          >
                            T{h.tier}
                          </span>
                          <span className="min-w-0">
                            <span className="font-medium text-foreground">{h.area}</span>
                            <span className="text-muted-foreground"> — {h.why}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            )}

            {/* Scope */}
            <section className="rounded-xl border border-border bg-card/30 p-6">
              <h2 className="mb-5 font-serif text-[18px] font-medium tracking-[-0.01em]">Matter scope</h2>
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
                <Field label="Practice area">
                  <select className={inputCls} value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>
                    {ASSET_CLASSES.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Client">
                  <input
                    className={inputCls}
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    placeholder="e.g. CVC Capital Partners"
                  />
                </Field>
                <Field label="Counterparty">
                  <input
                    className={inputCls}
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    placeholder="e.g. Recordati S.p.A."
                  />
                </Field>
                <Field label="Deal size">
                  <input
                    className={inputCls}
                    value={dealSize}
                    onChange={(e) => setDealSize(e.target.value)}
                    placeholder="e.g. €6.7bn"
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
            <section className="rounded-xl border border-border bg-card/30 p-6">
              <div className="mb-5 flex items-center gap-2">
                <Scales className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-serif text-[18px] font-medium tracking-[-0.01em]">Risk limits</h2>
                <span className="text-[11px] text-muted-foreground">— the boundaries every review must respect</span>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={`Compliance threshold — ${envelope}%`}>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={envelope}
                    onChange={(e) => setEnvelope(Number(e.target.value))}
                    className="w-full accent-[color:var(--color-foreground)]"
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Matters below this score are automatically flagged for partner review.
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
                  <Gavel className="h-3.5 w-3.5" /> Hard red-lines (never auto-pass)
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
            <section className="rounded-xl border border-border bg-card/30 p-6">
              <div className="mb-5 flex items-center gap-2">
                <Workstreams className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-serif text-[18px] font-medium tracking-[-0.01em]">Assign AI reviewers</h2>
                <span className="text-[11px] text-muted-foreground">— the AI team working within your risk limits</span>
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
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
                        <Workstreams className="h-3.5 w-3.5" />
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
              {agents.length} reviewer{agents.length === 1 ? "" : "s"} · {scope.length} clause categories · {redlines.length} red-line{redlines.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-3">
              {error && <span className="text-[12px] text-[color:var(--color-destructive)]">{error}</span>}
              <button
                onClick={deploy}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workstreams className="h-4 w-4" />}
                Create matter &amp; open board
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
