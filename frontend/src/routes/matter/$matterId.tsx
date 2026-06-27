import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type ElementType,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  GitBranch,
  Infinity,
  Link2,
  Loader2,
  Lock,
  Network,
  Paperclip,
  PenLine,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  getAudit,
  getHealth,
  getMatters,
  newSessionId,
  openTraceStream,
  sendChat,
  serviceForTool,
  signOff,
  type AuditRecord,
  type BackendAgentResult,
  type BackendTrace,
  type Classification,
  type EvidenceItem,
  type HealthResponse,
  type Matter,
  type Posture,
} from "@/lib/api";
import { LifecycleStepper } from "@/components/Lifecycle";
import { Brand } from "@/components/Brand";
import {
  DocumentFold,
  Gavel,
  Scales,
  Seal,
  SectionMark,
  SignatureLine,
  Statute,
} from "@/components/icons";

export const Route = createFileRoute("/matter/$matterId")({
  head: () => ({
    meta: [
      { title: "SignOff — M&A Decision Workspace" },
      { name: "description", content: "Document-first AI legal decisioning for live M&A transactions." },
    ],
  }),
  component: SignOff,
});

// ---------------------------------------------------------------------------
// Demo contract
// ---------------------------------------------------------------------------

const DEAL_DEFAULTS = {
  name: "Project Pennine",
  client: "CVC Capital Partners",
  counterparty: "Recordati S.p.A.",
  value: "€6.7bn",
  draft: "Draft v9",
  law: "English & Italian law",
};

const MATTER_STATUS_LABEL: Record<string, string> = {
  review: "In review",
  warning: "Warning",
  escalate: "Escalation",
  passed: "Cleared",
};

type Severity = "clean" | "review" | "policy";
type Risk = { phrase: string; kind: "high" | "policy" };
type Clause = {
  id: string;
  ref: string;
  title: string;
  text: string;
  severity: Severity;
  risks?: Risk[];
  redline?: { before: string; after: string };
};

const CLAUSES: Clause[] = [
  {
    id: "c31",
    ref: "§3.1",
    title: "Consideration & Completion Accounts",
    severity: "clean",
    text: "The aggregate consideration for the Shares shall be EUR 6,700,000,000, payable in cash at Completion, subject to the locked-box and leakage adjustments set out in Schedule 4 and the Completion Accounts mechanism in Schedule 5.",
  },
  {
    id: "c52",
    ref: "§5.2",
    title: "Conduct of Business (Interim Covenants)",
    severity: "review",
    risks: [{ phrase: "without the Purchaser's prior written consent", kind: "high" }],
    text: "Between Signing and Completion, the Group shall carry on its business in the ordinary course consistent with past practice and shall not, without the Purchaser's prior written consent, incur capital expenditure exceeding EUR 25,000,000 in aggregate or settle any litigation above EUR 5,000,000.",
  },
  {
    id: "c84",
    ref: "§8.4",
    title: "Material Adverse Change",
    severity: "policy",
    risks: [{ phrase: "including industry-wide regulatory shifts", kind: "policy" }],
    redline: {
      before: "including industry-wide regulatory shifts",
      after: "excluding industry-wide regulatory shifts unless they disproportionately affect the Group",
    },
    text: 'A "Material Adverse Change" means any event, change or effect that is materially adverse to the business, operations or financial condition of the Group, including industry-wide regulatory shifts, whether or not such effect disproportionately affects the Group relative to comparable industry participants.',
  },
  {
    id: "c93",
    ref: "§9.3",
    title: "Data Protection & International Transfers",
    severity: "review",
    risks: [
      { phrase: "transfer Personal Data outside the UK and EEA", kind: "policy" },
      { phrase: "without implementing the applicable safeguards", kind: "high" },
    ],
    text: "The Group may transfer Personal Data outside the UK and EEA to affiliates and service providers without implementing the applicable safeguards under Chapter V of the UK GDPR, provided that such transfers are necessary for the integration of the business following Completion.",
  },
  {
    id: "c111",
    ref: "§11.1",
    title: "Warranties, Limitations & Indemnities",
    severity: "policy",
    risks: [
      { phrase: "on an uncapped basis", kind: "policy" },
      { phrase: "without time limit", kind: "high" },
    ],
    text: "The Seller shall indemnify the Purchaser against all Losses arising from any breach of the Fundamental Warranties and any pre-Completion Tax Liability, on an uncapped basis and without time limit, notwithstanding the general liability cap of 20% of the consideration set out in Schedule 7.",
  },
  {
    id: "c125",
    ref: "§12.5",
    title: "Sanctions, ABC & Export Controls",
    severity: "review",
    risks: [{ phrase: "to the best of the Seller's knowledge", kind: "high" }],
    text: "To the best of the Seller's knowledge, no member of the Group nor any of its directors is a Restricted Party or has, in the five years prior to Signing, engaged in dealings with any person subject to EU, UK, or OFAC sanctions, or breached applicable anti-bribery and export control laws.",
  },
  {
    id: "c142",
    ref: "§14.2",
    title: "Conditions: Merger Control & FDI",
    severity: "policy",
    risks: [
      { phrase: "reasonable endeavours", kind: "policy" },
      { phrase: "no obligation to offer any remedies", kind: "high" },
    ],
    text: "Completion is conditional on clearance under the EU Merger Regulation and applicable foreign direct investment regimes. The Purchaser shall use reasonable endeavours to obtain such clearances but shall be under no obligation to offer any remedies, divestments or behavioural commitments to any competition or FDI authority.",
  },
  {
    id: "c173",
    ref: "§17.3",
    title: "Governing Law & Jurisdiction",
    severity: "clean",
    text: "This Agreement and any non-contractual obligations arising out of it shall be governed by English law and subject to the exclusive jurisdiction of the courts of England and Wales, save for the Italian law transfer formalities set out in Schedule 9.",
  },
];

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

// Color restraint: only true escalations (Tier 3 / policy breaches / rejection)
// carry red. Tier 1–2 and the agents are monochrome, separated by icon.
const SEV_COLOR: Record<Severity, string | undefined> = {
  clean: undefined,
  review: "var(--color-foreground)",
  policy: "var(--color-destructive)",
};

const TIER_STYLE: Record<number, { color: string; Icon: typeof Gavel; sub: string }> = {
  1: { color: "var(--color-muted-foreground)", Icon: Seal, sub: "Routine" },
  2: { color: "var(--color-foreground)", Icon: Scales, sub: "Material risk" },
  3: { color: "var(--color-destructive)", Icon: Gavel, sub: "Escalation required" },
};

const AGENT_META: Record<string, { name: string; vendor: string; Icon: typeof Gavel; color: string }> = {
  risk: { name: "Risk Agent", vendor: "NVIDIA NIM", Icon: Gavel, color: "var(--color-foreground)" },
  precedent: { name: "Precedent Agent", vendor: "Vertex AI", Icon: Scales, color: "var(--color-foreground)" },
  deal: { name: "Deal Agent", vendor: "Gemini 2.5 Flash", Icon: Seal, color: "var(--color-foreground)" },
};

const EVIDENCE_META: Record<EvidenceItem["kind"], { Icon: typeof Gavel; label: string }> = {
  precedent: { Icon: Scales, label: "Precedents" },
  regulation: { Icon: Statute, label: "Regulations" },
  citation: { Icon: SectionMark, label: "Citations" },
};

const POSTURES = [
  { id: "approve", label: "Approve", Icon: Check, color: "var(--color-foreground)" },
  { id: "amend", label: "Amend", Icon: PenLine, color: "var(--color-muted-foreground)" },
  { id: "reject", label: "Reject", Icon: X, color: "var(--color-destructive)" },
] as const;

function uiAgent(name: string): "risk" | "precedent" | "deal" {
  const n = name.toLowerCase();
  if (n.includes("risk")) return "risk";
  if (n.includes("precedent")) return "precedent";
  return "deal";
}

// ---------------------------------------------------------------------------
// Playbook (no-code tier ruleset — the firm's Delegation of Authority matrix)
// ---------------------------------------------------------------------------

type PbTier = 1 | 2 | 3;
type Rule = { id: string; subject: string; operator: string; value: string; tier: PbTier };

const PB_TIERS: { tier: PbTier; label: string; color: string }[] = [
  { tier: 3, label: "Critical", color: "var(--color-destructive)" },
  { tier: 2, label: "Warning", color: "var(--color-foreground)" },
  { tier: 1, label: "Notice", color: "var(--color-muted-foreground)" },
];

const PB_SUBJECTS = [
  "Liability Cap",
  "MAC Clause Scope",
  "Governing Law",
  "Indemnity Cap",
  "GDPR Art. 28 Clause",
  "Payment Terms",
  "Entity Names",
  "Termination Notice",
  "Confidentiality Term",
  "Cross-clause Consistency",
  "Warranty Survival Period",
];

const PB_OPERATORS = [
  "is greater than",
  "is less than",
  "equals",
  "is not in",
  "is missing",
  "is present",
  "is expanded",
  "is outdated",
  "contradicts",
];

const PB_NO_VALUE = new Set(["is missing", "is present", "is outdated"]);

const PB_ACTIONS = [
  "Hard Pause — Head of Legal sign-off required",
  "Escalate to Deal Partners",
  "Soft Review — counsel rationale required",
  "Auto-Approve — recorded in audit log only",
];

const DEFAULT_DEFS: Record<PbTier, string> = {
  3: "Structural deal-breakers or severe policy violations.",
  2: "Moderate deviations from standard playbook positions.",
  1: "Low-risk deviations, formatting, or housekeeping items.",
};

const DEFAULT_ACTIONS: Record<PbTier, string> = {
  3: "Hard Pause — Head of Legal sign-off required",
  2: "Soft Review — counsel rationale required",
  1: "Auto-Approve — recorded in audit log only",
};

let _rid = 0;
const mkRule = (subject: string, operator: string, value: string, tier: PbTier): Rule => ({
  id: `r${++_rid}`,
  subject,
  operator,
  value,
  tier,
});

const DEFAULT_RULES: Rule[] = [
  mkRule("MAC Clause Scope", "is expanded", "beyond standard carve-outs", 3),
  mkRule("Liability Cap", "is greater than", "$5,000,000", 3),
  mkRule("Cross-clause Consistency", "contradicts", "another clause", 3),
  mkRule("Governing Law", "is not in", "New York, Delaware", 2),
  mkRule("GDPR Art. 28 Clause", "is missing", "", 2),
  mkRule("Payment Terms", "is greater than", "60 days", 1),
  mkRule("Entity Names", "is outdated", "", 1),
];

const pbTokenCls =
  "rounded-md border border-border-strong bg-surface-elevated px-2 py-1 text-[12px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

function PlaybookRule({
  rule,
  onChange,
  onRemove,
}: {
  rule: Rule;
  onChange: (patch: Partial<Rule>) => void;
  onRemove: () => void;
}) {
  const needsValue = !PB_NO_VALUE.has(rule.operator);
  return (
    <div className="group flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-3 py-2 text-[12px] text-muted-foreground">
      <span>When a clause’s</span>
      <select className={pbTokenCls} value={rule.subject} onChange={(e) => onChange({ subject: e.target.value })}>
        {PB_SUBJECTS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select className={pbTokenCls} value={rule.operator} onChange={(e) => onChange({ operator: e.target.value })}>
        {PB_OPERATORS.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {needsValue && (
        <input
          className={`${pbTokenCls} w-44`}
          value={rule.value}
          placeholder="value…"
          onChange={(e) => onChange({ value: e.target.value })}
        />
      )}
      <span>→ classify as</span>
      <select
        className={`${pbTokenCls} font-semibold`}
        style={{ color: (PB_TIERS.find((t) => t.tier === rule.tier) ?? PB_TIERS[0]).color }}
        value={rule.tier}
        onChange={(e) => onChange({ tier: Number(e.target.value) as PbTier })}
      >
        {PB_TIERS.map((t) => (
          <option key={t.tier} value={t.tier}>Tier {t.tier} · {t.label}</option>
        ))}
      </select>
      <button
        onClick={onRemove}
        title="Remove trigger"
        className="ml-auto rounded-md p-1 text-muted-foreground/60 opacity-0 transition hover:bg-accent hover:text-[color:var(--color-destructive)] group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Playbook({
  rules,
  setRules,
  defs,
  setDefs,
  actions,
  setActions,
  onClose,
}: {
  rules: Rule[];
  setRules: (fn: (r: Rule[]) => Rule[]) => void;
  defs: Record<PbTier, string>;
  setDefs: (fn: (d: Record<PbTier, string>) => Record<PbTier, string>) => void;
  actions: Record<PbTier, string>;
  setActions: (fn: (a: Record<PbTier, string>) => Record<PbTier, string>) => void;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState(false);
  function save() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }
  return (
    <div className="flex w-full min-w-0 flex-col bg-background">
      {/* Tab strip echoing the editor chrome */}
      <div className="flex items-stretch border-b border-border bg-surface text-[12px]">
        <div className="flex items-center gap-2 border-r border-border bg-background px-3 py-1.5 text-foreground">
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Playbook Settings</span>
        </div>
        <button onClick={onClose} className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to document
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl px-8 py-8">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight">Risk Playbook</h1>
              <p className="mt-1 max-w-xl text-[12px] text-muted-foreground">
                Your firm’s Delegation of Authority. These guardrails decide how every clause is triaged across all
                matters — line attorneys never see this; only partners and legal ops tune it.
              </p>
            </div>
            <button
              onClick={save}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {saved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <>Save playbook</>}
            </button>
          </div>

          <div className="space-y-4">
            {PB_TIERS.map((t) => {
              const tierRules = rules.filter((r) => r.tier === t.tier);
              return (
                <section
                  key={t.tier}
                  className="rounded-xl border bg-card/40 p-4"
                  style={{ borderLeft: `3px solid ${t.color}` }}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                    <span className="text-sm font-bold" style={{ color: t.color }}>Tier {t.tier}</span>
                    <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {t.label}
                    </span>
                    <input
                      value={defs[t.tier]}
                      onChange={(e) => setDefs((d) => ({ ...d, [t.tier]: e.target.value }))}
                      className="ml-1 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[12px] text-muted-foreground hover:border-border focus:border-border-strong focus:bg-surface/60 focus:text-foreground focus:outline-none"
                    />
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="font-semibold uppercase tracking-wider text-muted-foreground">Required action</span>
                    <select
                      className={pbTokenCls}
                      value={actions[t.tier]}
                      onChange={(e) => setActions((a) => ({ ...a, [t.tier]: e.target.value }))}
                    >
                      {PB_ACTIONS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Triggers ({tierRules.length})
                    </span>
                    {tierRules.map((r) => (
                      <PlaybookRule
                        key={r.id}
                        rule={r}
                        onChange={(patch) => setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)))}
                        onRemove={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                      />
                    ))}
                    <button
                      onClick={() => setRules((rs) => [...rs, mkRule(PB_SUBJECTS[0], PB_OPERATORS[0], "", t.tier)])}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border-strong px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add trigger
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderWithHighlights(text: string, risks?: Risk[]): ReactNode {
  if (!risks?.length) return text;
  const map = new Map(risks.map((r) => [r.phrase, r.kind]));
  const escaped = risks.map((r) => r.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  return text.split(re).map((part, i) => {
    const kind = map.get(part);
    if (!kind) return <span key={i}>{part}</span>;
    const color = kind === "policy" ? "var(--color-destructive)" : "var(--color-foreground)";
    return (
      <mark
        key={i}
        className="rounded px-0.5 underline decoration-wavy underline-offset-4"
        style={{
          backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
          color: "var(--color-foreground)",
          textDecorationColor: color,
        }}
      >
        {part}
      </mark>
    );
  });
}

function renderReasoning(text: string): ReactNode {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const allBullets = lines.every((l) => /^[-•*]/.test(l));
  if (allBullets) {
    return (
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
            <CircleDot className="mt-1.5 h-2 w-2 shrink-0 text-muted-foreground/50" />
            <span>{l.replace(/^[-•*]\s*/, "")}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-2.5">
      {lines.map((l, i) => (
        <p key={i} className="text-[13px] leading-relaxed text-muted-foreground">
          {l.replace(/^[-•*]\s*/, "")}
        </p>
      ))}
    </div>
  );
}

function splitTrigger(t: string): { title: string; detail?: string } {
  const parts = t.split(/\s+[—–]\s+|:\s+/);
  if (parts.length >= 2) {
    return { title: parts[0].trim(), detail: parts.slice(1).join(" ").trim() };
  }
  return { title: t.trim() };
}

function triggerVisual(t: string): { Icon: typeof Gavel; color: string } {
  const s = t.toLowerCase();
  if (s.includes("contradiction") || s.includes("↔")) {
    return { Icon: Scales, color: "var(--color-foreground)" };
  }
  if (s.includes("precedent")) return { Icon: Scales, color: "var(--color-foreground)" };
  if (
    s.includes("gdpr") ||
    s.includes("regulation") ||
    s.includes("data-processing") ||
    s.includes("directive") ||
    s.includes("art.")
  ) {
    return { Icon: Statute, color: "var(--color-foreground)" };
  }
  if (s.includes("risk") || s.includes("exposure")) {
    return { Icon: Gavel, color: "var(--color-destructive)" };
  }
  return { Icon: Gavel, color: "var(--color-destructive)" };
}

function parseRecommendation(text: string): { actions: string[]; research: string; body: string } {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const actions: string[] = [];
  const research: string[] = [];
  const body: string[] = [];
  let inResearch = false;
  for (const l of lines) {
    if (/^research\b/i.test(l)) {
      inResearch = true;
      const r = l.replace(/^research\s*[:\-–]?\s*/i, "");
      if (r) research.push(r);
      continue;
    }
    if (inResearch) {
      research.push(l);
      continue;
    }
    if (/^[-•*]/.test(l)) {
      const item = l.replace(/^[-•*]\s*/, "");
      for (const part of item.split(/;\s*/)) {
        const p = part.trim().replace(/\.$/, "");
        if (p) actions.push(p.charAt(0).toUpperCase() + p.slice(1));
      }
      continue;
    }
    if (/^recommendation\s*[:\-]/i.test(l)) continue;
    body.push(l);
  }
  return { actions, research: research.join(" ").trim(), body: body.join(" ").trim() };
}

function Disclosure({
  title,
  icon: Icon,
  count,
  tone,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ElementType;
  count?: number;
  tone?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/70 bg-surface/40">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Icon className="h-3.5 w-3.5 shrink-0" style={tone ? { color: tone } : undefined} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {count !== undefined && (
          <span className="rounded-full bg-muted/60 px-1.5 text-[10px] font-medium text-muted-foreground">{count}</span>
        )}
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="px-3 pb-3 pt-0.5">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

type Analysis = {
  classification: Classification;
  agents: BackendAgentResult[];
  evidence: EvidenceItem[];
  traces: BackendTrace[];
};

function SignOff() {
  const { matterId } = Route.useParams();
  const [matters, setMatters] = useState<Matter[]>([]);
  const [selectedId, setSelectedId] = useState<string>("c84");
  const [analyses, setAnalyses] = useState<Record<string, Analysis>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [posture, setPosture] = useState<Posture | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<EvidenceItem["kind"] | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [signing, setSigning] = useState(false);
  const [audit, setAudit] = useState<AuditRecord[]>([]);
  const [auditVerified, setAuditVerified] = useState<boolean | null>(null);
  const [showProvenance, setShowProvenance] = useState(false);
  const [liveTraces, setLiveTraces] = useState<BackendTrace[]>([]);
  const [input, setInput] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [view, setView] = useState<"document" | "playbook">("document");
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [defs, setDefs] = useState<Record<PbTier, string>>(DEFAULT_DEFS);
  const [actions, setActions] = useState<Record<PbTier, string>>(DEFAULT_ACTIONS);
  const sessionRef = useRef<string>("");

  const currentMatter = matters.find((m) => m.id === matterId);
  const deal = {
    ...DEAL_DEFAULTS,
    name: currentMatter?.name ?? DEAL_DEFAULTS.name,
    value: currentMatter?.deal_size ?? DEAL_DEFAULTS.value,
    client: currentMatter?.client ?? DEAL_DEFAULTS.client,
    counterparty: currentMatter?.counterparty ?? DEAL_DEFAULTS.counterparty,
    law: currentMatter?.jurisdiction ?? DEAL_DEFAULTS.law,
  };

  const selected = CLAUSES.find((c) => c.id === selectedId) ?? null;
  const analysis = selected ? analyses[selected.id] : undefined;
  const loading = loadingId === selectedId;

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getMatters().then((r) => setMatters(r.matters)).catch(() => setMatters([]));
    const mac = CLAUSES.find((c) => c.id === "c84");
    if (mac) void runAnalysis(mac, mac.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAudit() {
    try {
      const r = await getAudit(matterId);
      setAudit(r.events.filter((e) => e.type === "signoff"));
      setAuditVerified(r.verified);
    } catch {
      setAudit([]);
      setAuditVerified(null);
    }
  }

  useEffect(() => {
    void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  async function runAnalysis(c: Clause, message: string) {
    const sessionId = newSessionId();
    sessionRef.current = sessionId;
    setLoadingId(c.id);
    setLiveTraces([]);

    // Open the live trace stream BEFORE kicking off the analysis so the partner
    // watches each agent (NIM, Neo4j, Perplexity, EU Cellar, Gemini) light up
    // and resolve in real time. Frames upsert by id (running → success/failed).
    const stream = openTraceStream(sessionId, (t) => {
      setLiveTraces((prev) => {
        const idx = prev.findIndex((x) => x.id === t.id);
        if (idx === -1) return [...prev, t];
        const next = prev.slice();
        next[idx] = t;
        return next;
      });
    });

    try {
      const res = await sendChat(message, sessionId);
      setAnalyses((prev) => ({
        ...prev,
        [c.id]: {
          classification: res.classification,
          agents: res.agents,
          evidence: res.evidence,
          traces: res.traces,
        },
      }));
      setPosture(res.classification.recommended_posture);
    } catch {
      // leave un-analyzed; panel shows a retry hint
    } finally {
      stream.close();
      setLoadingId(null);
    }
  }

  function selectClause(c: Clause) {
    setSelectedId(c.id);
    setPosture(analyses[c.id]?.classification.recommended_posture ?? null);
    setShowReasoning(false);
    setOpenEvidence(null);
    setShowAudit(false);
    if (c.severity !== "clean" && !analyses[c.id] && loadingId !== c.id) {
      void runAnalysis(c, c.text);
    }
  }

  function goToClause(c: Clause) {
    selectClause(c);
    requestAnimationFrame(() =>
      document.getElementById(c.id)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  function jumpToHighestRisk() {
    const rank: Record<Severity, number> = { policy: 0, review: 1, clean: 2 };
    const flagged = CLAUSES.filter((c) => c.severity !== "clean").sort(
      (a, b) => rank[a.severity] - rank[b.severity],
    );
    if (flagged.length === 0) return;
    const idx = flagged.findIndex((c) => c.id === selectedId);
    goToClause(flagged[(idx + 1) % flagged.length]);
  }

  function runPrompt() {
    const text = input.trim();
    if (!text || !selected || loading) return;
    setInput("");
    void runAnalysis(selected, `${text}\n\nClause ${selected.ref}:\n${selected.text}`);
  }

  function handlePrompt(e: FormEvent) {
    e.preventDefault();
    runPrompt();
  }

  async function handleSignoff() {
    if (!posture || !rationale.trim() || signing || !selected) return;
    setSigning(true);
    const recommended = analysis?.classification.recommended_posture;
    const isOverride = !!recommended && posture !== recommended;
    try {
      await signOff({
        session_id: sessionRef.current || "session-demo",
        posture,
        rationale: rationale.trim(),
        tier: analysis?.classification.tier ?? 0,
        author: "Rob Clay",
        matter_id: matterId,
        clause_ref: selected.ref,
        clause_title: selected.title,
        recommended_posture: recommended,
        override: isOverride,
        confidence: analysis?.classification.confidence,
      });
      await loadAudit();
      setRationale("");
      setModalOpen(false);
    } catch {
      /* keep modal open to retry */
    } finally {
      setSigning(false);
    }
  }

  const dealAgent = analysis?.agents.find((a) => a.phase === "resolution") ?? analysis?.agents.at(-1);
  const meshLive = health ? Object.values(health.integrations).some((v) => v === "live") : false;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Topbar ── */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/60 px-5 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to="/"
            title="Back to risk ledger"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">Ledger</span>
          </Link>
          <Link
            to="/coordinate/$matterId"
            params={{ matterId }}
            title="Back to coordination board"
            className="hidden items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
          >
            <Network className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">Coordinate</span>
          </Link>
          <span className="h-4 w-px bg-border" />
          <Link to="/">
            <Brand />
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate font-serif text-[15px] font-medium tracking-[-0.01em]">{deal.name}</span>
          <span className="hidden md:inline rounded-md border border-border bg-surface-elevated px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {deal.draft} · {deal.value}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="hidden xl:block">
            <LifecycleStepper current={currentMatter?.stage ?? "review"} matterId={matterId} compact />
          </span>
          <span className="flex items-center gap-1.5">
            <Network className="h-3 w-3" />
            {health ? (meshLive ? "mesh online" : "demo mode") : "offline"}
          </span>
          <span className="hidden lg:inline font-mono">{deal.law}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Left rail: matters + clause outline ── */}
        <nav className="flex w-56 shrink-0 flex-col border-r border-border bg-surface/60">
          {/* Profile + Playbook settings entry point */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-foreground">RC</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-foreground">Clifford Chance</span>
                <span className="block truncate text-[10px] text-muted-foreground">Rob Clay · Partner</span>
              </span>
            </div>
            <button
              onClick={() => setView((v) => (v === "playbook" ? "document" : "playbook"))}
              title="Playbook settings"
              className={`rounded-md p-1.5 transition-colors ${
                view === "playbook"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-between px-3 pt-6 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active Deals</span>
            <button className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="New matter">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-0.5 px-2">
            {matters.map((m) => {
              const active = m.id === matterId;
              return (
                <Link
                  key={m.id}
                  to="/matter/$matterId"
                  params={{ matterId: m.id }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                    active ? "bg-card" : "hover:bg-card/50"
                  }`}
                >
                  <DocumentFold className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? "text-foreground" : "text-muted-foreground"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[12px] font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>{m.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{m.asset_class} · {m.deal_size}</span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-foreground" : "bg-muted-foreground/40"}`} />
                      {MATTER_STATUS_LABEL[m.status] ?? m.status}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="px-3 pt-6 pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Clauses</span>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto scrollbar-thin px-2 pb-3">
            {CLAUSES.map((c) => {
              const isSel = c.id === selectedId;
              const dot = SEV_COLOR[c.severity];
              return (
                <button
                  key={c.id}
                  onClick={() => goToClause(c)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    isSel ? "bg-accent" : "hover:bg-card/50"
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot ?? "var(--color-muted-foreground)" }} />
                  <span className="font-mono text-[10px] text-muted-foreground">{c.ref}</span>
                  <span className={`truncate text-[11px] ${isSel ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{c.title}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* ── Doc + panel (document-first 60/40) ── */}
        <div className="flex min-w-0 flex-1">
        {view === "playbook" ? (
          <Playbook
            rules={rules}
            setRules={setRules}
            defs={defs}
            setDefs={setDefs}
            actions={actions}
            setActions={setActions}
            onClose={() => setView("document")}
          />
        ) : (
        <>
        {/* ── Editor: tab strip + document (60%) ── */}
        <div className="flex w-3/5 min-w-0 flex-col">
          <div className="flex items-stretch border-b border-border bg-surface text-[12px]">
            <div className="flex items-center gap-2 border-r border-border bg-background px-3 py-1.5 text-foreground">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span>SPA_{deal.name.replace(/\s+/g, "_")}.md</span>
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/70" title="Unsaved changes" />
            </div>
            <div className="flex items-center gap-2 border-r border-border px-3 py-1.5 text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span>disclosure_schedules.pdf</span>
            </div>
            <div className="ml-auto flex items-center px-3 font-mono text-[10px] text-muted-foreground">
              {selected ? `${selected.ref} · ` : ""}{deal.draft}
            </div>
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin bg-background">
          <div className="mx-auto max-w-3xl px-8 py-8">
            <div className="mb-8 border-b border-border pb-5">
              <h1 className="font-serif text-[24px] font-medium leading-tight tracking-[-0.01em]">
                Share Purchase Agreement
              </h1>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {deal.client} ⟶ {deal.counterparty} · Buy-side · {deal.draft}
              </p>
            </div>

            {CLAUSES.map((c) => {
              const isSel = c.id === selectedId;
              const sev = SEV_COLOR[c.severity];
              const ca = analyses[c.id];
              return (
                <div
                  key={c.id}
                  onClick={() => selectClause(c)}
                  className={`group relative cursor-pointer rounded-lg border pl-6 pr-4 transition-all duration-200 ${
                    isSel
                      ? "mb-4 border-border-strong bg-card py-5 opacity-100"
                      : "mb-1.5 border-transparent py-2.5 opacity-65 hover:bg-card/50 hover:opacity-100"
                  }`}
                >
                  {sev && (
                    <span className="absolute left-2 top-3 bottom-3 w-0.5 rounded-full" style={{ background: sev }} />
                  )}
                  <div className={`flex items-center gap-2.5 ${isSel ? "mb-3" : ""}`}>
                    <ChevronRight
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isSel ? "rotate-90" : ""}`}
                    />
                    <span className="font-mono text-[11px] text-muted-foreground">{c.ref}</span>
                    <span className="font-serif text-[16px] font-medium tracking-[-0.01em]">{c.title}</span>
                    {c.severity === "policy" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive)]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[color:var(--color-destructive)]">
                        <Gavel className="h-2.5 w-2.5" /> Policy
                      </span>
                    )}
                    {c.severity === "review" && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border-strong px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                        <Scales className="h-2.5 w-2.5" /> Review
                      </span>
                    )}
                    {ca && (
                      <span
                        className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold"
                        style={{
                          color: (TIER_STYLE[ca.classification.tier] ?? TIER_STYLE[2]).color,
                          backgroundColor: `color-mix(in oklab, ${(TIER_STYLE[ca.classification.tier] ?? TIER_STYLE[2]).color} 16%, transparent)`,
                        }}
                      >
                        TIER {ca.classification.tier}
                      </span>
                    )}
                  </div>

                  {isSel && (
                    <p className="text-[14px] leading-7 text-foreground/90 animate-reveal">
                      {renderWithHighlights(c.text, c.risks)}
                    </p>
                  )}

                  {/* Inline redline diff — stacked, GitHub/Cursor-style */}
                  {isSel && c.redline && posture === "amend" && (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-surface/60 p-4 text-[13px] leading-relaxed">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <PenLine className="h-3 w-3 text-muted-foreground" /> Proposed redline
                      </div>
                      <div className="flex items-start gap-2.5 rounded-md bg-[color:var(--color-destructive)]/10 px-3 py-2">
                        <span className="mt-px font-mono font-semibold text-[color:var(--color-destructive)]">−</span>
                        <span className="text-foreground/70 line-through decoration-[color:var(--color-destructive)]/50 decoration-1">
                          {c.redline.before}
                        </span>
                      </div>
                      <div className="flex items-start gap-2.5 rounded-md bg-foreground/[0.06] px-3 py-2">
                        <span className="mt-px font-mono font-semibold text-foreground">+</span>
                        <span className="text-foreground">{c.redline.after}</span>
                      </div>
                    </div>
                  )}

                  {/* Proximity action toolbar */}
                  {isSel && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-3 flex w-fit items-center gap-1 rounded-xl border border-border bg-surface-elevated/95 px-1.5 py-1.5 shadow-lg backdrop-blur"
                    >
                      {POSTURES.map((p) => {
                        const active = posture === p.id;
                        const rec = analysis?.classification.recommended_posture === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => setPosture(p.id)}
                            className="relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors"
                            style={{
                              color: active ? p.color : "var(--color-muted-foreground)",
                              backgroundColor: active ? `color-mix(in oklab, ${p.color} 15%, transparent)` : "transparent",
                            }}
                          >
                            <p.Icon className="h-3.5 w-3.5" />
                            {p.label}
                            {rec && (
                              <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-foreground" />
                            )}
                          </button>
                        );
                      })}
                      {posture &&
                        analysis?.classification.recommended_posture &&
                        posture !== analysis.classification.recommended_posture && (
                          <span
                            title={`Overriding AI recommendation (${analysis.classification.recommended_posture})`}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              color: "var(--color-destructive)",
                              backgroundColor: "color-mix(in oklab, var(--color-destructive) 14%, transparent)",
                            }}
                          >
                            <Gavel className="h-3 w-3" /> Override
                          </span>
                        )}
                      <span className="mx-0.5 h-5 w-px bg-border" />
                      {audit.some((a) => a.data?.clause_ref === c.ref) ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Signed
                        </span>
                      ) : (
                        <button
                          onClick={() => setModalOpen(true)}
                          disabled={!posture}
                          title={`Commit this decision for ${c.ref}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <SignatureLine className="h-3.5 w-3.5" /> Sign off {c.ref}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </main>
        </div>

        {/* ── AI intervention panel (40%) ── */}
        <aside className="flex w-2/5 min-w-0 flex-col border-l border-border bg-surface/50">
          {!selected ? (
            <div className="p-6 text-[13px] text-muted-foreground">Select a clause to review.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{selected.ref}</span>
                    <h2 className="truncate font-serif text-[16px] font-medium tracking-[-0.01em]">{selected.title}</h2>
                  </div>
                  {analysis && (
                    <span className="text-[11px]" style={{ color: (TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color }}>
                      TIER {analysis.classification.tier} · {analysis.classification.tier_label}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowAudit((v) => !v)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Lock className="h-3 w-3" /> Audit
                  {audit.length > 0 && <span className="font-mono">{audit.length}</span>}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-5 space-y-4">
                {showAudit && (
                  <div className="animate-reveal rounded-lg border border-white/[0.06] bg-card/50 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Audit trail</h3>
                      {auditVerified !== null && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                          style={{
                            color: auditVerified ? "var(--color-foreground)" : "var(--color-destructive)",
                            backgroundColor: `color-mix(in oklab, ${auditVerified ? "var(--color-foreground)" : "var(--color-destructive)"} 12%, transparent)`,
                          }}
                          title="Each record embeds the SHA-256 hash of the previous one. The server recomputes the chain on every read."
                        >
                          <Lock className="h-2.5 w-2.5" />
                          {auditVerified ? "Hash chain verified" : "Chain integrity broken"}
                        </span>
                      )}
                    </div>
                    <Link
                      to="/audit"
                      className="mb-2 inline-flex items-center gap-1 text-[11px] text-foreground link-underline"
                    >
                      View full portfolio trail <ArrowUpRight className="h-3 w-3" />
                    </Link>
                    {audit.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">No decisions signed yet for this matter.</p>
                    ) : (
                      <ul className="space-y-2">
                        {audit.map((a) => (
                          <li key={a.id} className="rounded-md border border-border/70 bg-surface/40 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold capitalize text-foreground">
                                <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                                {String(a.data?.posture ?? "")} · {String(a.data?.clause_ref ?? "")}
                                {a.data?.override === true && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                                    style={{
                                      color: "var(--color-destructive)",
                                      backgroundColor: "color-mix(in oklab, var(--color-destructive) 14%, transparent)",
                                    }}
                                    title={`Override of AI recommendation (${String(a.data?.recommended_posture ?? "")})`}
                                  >
                                    <Gavel className="h-2.5 w-2.5" /> Override
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground" title={`hash ${a.hash}`}>
                                #{a.seq} · {a.hash.slice(0, 8)}
                              </span>
                            </div>
                            <p className="mt-1 text-[12px] text-muted-foreground">{String(a.data?.rationale ?? "")}</p>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground/80">
                              <span>{a.actor}</span>
                              <span className="font-mono">{new Date(a.timestamp).toLocaleString()}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {loading ? (
                  <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                      <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Agent mesh executing
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {liveTraces.filter((t) => t.status !== "running").length}/{liveTraces.length || "…"}
                      </span>
                    </div>
                    {liveTraces.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground/80">
                        Dispatching asymmetric agents…
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {liveTraces.map((t) => {
                          const live = t.mode === "live";
                          const ms =
                            t.finished_at && t.started_at
                              ? new Date(t.finished_at).getTime() - new Date(t.started_at).getTime()
                              : undefined;
                          const running = t.status === "running";
                          const failed = t.status === "failed";
                          return (
                            <li
                              key={t.id}
                              className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-surface/40 px-3 py-2 animate-reveal"
                            >
                              {running ? (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-foreground" />
                              ) : (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor: failed
                                      ? "var(--color-destructive)"
                                      : "var(--color-foreground)",
                                  }}
                                />
                              )}
                              <span
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                                style={{
                                  color: live ? "var(--color-foreground)" : "var(--color-muted-foreground)",
                                  backgroundColor: live
                                    ? "color-mix(in oklab, var(--color-foreground) 12%, transparent)"
                                    : "var(--color-muted)",
                                }}
                              >
                                {live ? "Live" : "Demo"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-medium text-foreground">
                                  {serviceForTool(t.tool)}
                                </p>
                                <p className="truncate text-[10px] text-muted-foreground">{t.detail}</p>
                              </div>
                              {running ? (
                                <span className="shrink-0 text-[10px] font-medium text-muted-foreground">running…</span>
                              ) : (
                                <>
                                  {ms !== undefined && (
                                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{ms}ms</span>
                                  )}
                                  <span
                                    className="shrink-0 text-[10px] font-medium"
                                    style={{
                                      color: failed
                                        ? "var(--color-destructive)"
                                        : "var(--color-muted-foreground)",
                                    }}
                                  >
                                    {t.status}
                                  </span>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : selected.severity === "clean" && !analysis ? (
                  <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-card/40 px-4 py-3.5 text-[13px] text-muted-foreground">
                    <Seal className="h-4 w-4 text-muted-foreground" /> No material issues detected.
                  </div>
                ) : analysis ? (
                  <>
                    {/* Why flagged — the immediate crisis, kept at the top */}
                    {analysis.classification.triggers.length > 0 && (
                      <div
                        className="rounded-xl border bg-card/50 p-5"
                        style={{
                          borderColor: `color-mix(in oklab, ${(TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color} 35%, var(--color-border))`,
                        }}
                      >
                        <div className="mb-3 flex items-center gap-1.5">
                          <Gavel className="h-3.5 w-3.5" style={{ color: (TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color }} />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why flagged</span>
                        </div>
                        <ul className="space-y-2.5">
                          {analysis.classification.triggers.map((t, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-foreground">
                              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: (TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color }} />
                              <span>{t}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Recommendation */}
                    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5">
                      <div className="mb-3 flex items-center gap-2">
                        <Seal className="h-3.5 w-3.5" style={{ color: AGENT_META.deal.color }} />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recommendation</span>
                        <span className="ml-auto rounded-md bg-muted/50 px-2 py-0.5 text-[11px] font-semibold capitalize text-foreground">
                          {analysis.classification.recommended_posture}
                        </span>
                      </div>

                      {/* Confidence signalling — predictive indicator of model certainty */}
                      {(() => {
                        const conf = analysis.classification.confidence ?? 0;
                        const pct = Math.round(conf * 100);
                        const low = conf < 0.75;
                        const accent = low ? "var(--color-destructive)" : "var(--color-foreground)";
                        return (
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                              <span>Model confidence</span>
                              <span className="font-mono tabular-nums" style={{ color: accent }}>{pct}%</span>
                            </div>
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted/50">
                              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: accent }} />
                            </div>
                            {low && (
                              <div className="mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed animate-reveal"
                                style={{
                                  borderColor: "color-mix(in oklab, var(--color-destructive) 35%, var(--color-border))",
                                  color: "var(--color-foreground)",
                                }}>
                                <Gavel className="mt-px h-3.5 w-3.5 shrink-0 text-[color:var(--color-destructive)]" />
                                <span><strong className="font-semibold">Low confidence / elevated uncertainty.</strong> The mesh signals possible ambiguity or conflicting evidence — verify manually before sign-off.</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {renderReasoning(dealAgent?.reasoning || dealAgent?.summary || "")}
                    </div>

                    {/* On-demand evidence tags */}
                    <div>
                      <div className="flex flex-wrap gap-2">
                        {(["precedent", "regulation", "citation"] as const).map((k) => {
                          const m = EVIDENCE_META[k];
                          const { Icon } = m;
                          const n = analysis.evidence.filter((e) => e.kind === k).length;
                          const active = openEvidence === k;
                          return (
                            <button
                              key={k}
                              onClick={() => setOpenEvidence(active ? null : k)}
                              disabled={n === 0}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                                active ? "border-border-strong bg-accent text-foreground" : "border-border text-muted-foreground hover:bg-accent/50"
                              }`}
                            >
                              <Icon className="h-3 w-3" /> View {m.label}
                              <span className="font-mono opacity-70">{n}</span>
                            </button>
                          );
                        })}
                      </div>
                      {openEvidence && (
                        <ul className="mt-2 space-y-1.5 animate-reveal">
                          {analysis.evidence
                            .filter((e) => e.kind === openEvidence)
                            .map((e, i) => (
                              <li key={i} className="rounded-lg border border-white/[0.06] bg-card/60 px-3.5 py-2.5">
                                <p className="text-[12px] font-semibold leading-snug text-foreground">{e.title}</p>
                                {e.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{e.detail}</p>}
                                <div className="mt-1 flex items-center justify-between gap-2">
                                  <span className="font-mono text-[10px] text-muted-foreground">{e.source}</span>
                                  {e.url && (
                                    <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-foreground link-underline">
                                      Open <ArrowUpRight className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>

                    {/* Provenance — which tools ran, live vs demo, latency, status */}
                    {analysis.traces.length > 0 && (
                      <div>
                        <button
                          onClick={() => setShowProvenance((v) => !v)}
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          {showProvenance ? "Hide" : "View"} provenance
                          <span className="font-mono opacity-70">{analysis.traces.length}</span>
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showProvenance ? "" : "-rotate-90"}`} />
                        </button>
                        {showProvenance && (
                          <ul className="mt-2 space-y-1.5 animate-reveal">
                            {analysis.traces.map((t) => {
                              const live = t.mode === "live";
                              const ms =
                                t.finished_at && t.started_at
                                  ? new Date(t.finished_at).getTime() - new Date(t.started_at).getTime()
                                  : undefined;
                              return (
                                <li
                                  key={t.id}
                                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-surface/40 px-3 py-2"
                                >
                                  <span
                                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                                    style={{
                                      color: live ? "var(--color-foreground)" : "var(--color-muted-foreground)",
                                      backgroundColor: live
                                        ? "color-mix(in oklab, var(--color-foreground) 12%, transparent)"
                                        : "var(--color-muted)",
                                    }}
                                  >
                                    {live ? "Live" : "Demo"}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[12px] font-medium text-foreground">
                                      {serviceForTool(t.tool)}
                                    </p>
                                    <p className="truncate text-[10px] text-muted-foreground">{t.detail}</p>
                                  </div>
                                  {ms !== undefined && (
                                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{ms}ms</span>
                                  )}
                                  <span
                                    className="shrink-0 text-[10px] font-medium"
                                    style={{
                                      color:
                                        t.status === "failed"
                                          ? "var(--color-destructive)"
                                          : "var(--color-muted-foreground)",
                                    }}
                                  >
                                    {t.status}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Demoted telemetry */}
                    <div>
                      <button
                        onClick={() => setShowReasoning((v) => !v)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {showReasoning ? "Hide" : "View"} agent reasoning
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showReasoning ? "" : "-rotate-90"}`} />
                      </button>
                      {showReasoning && (
                        <div className="mt-2 space-y-2 animate-reveal">
                          {analysis.agents.map((a) => {
                            const m = AGENT_META[uiAgent(a.agent)];
                            const { Icon } = m;
                            return (
                              <div key={a.agent} className="rounded-lg border border-white/[0.06] bg-surface/40 p-3.5">
                                <div className="mb-1.5 flex items-center gap-2">
                                  <Icon className="h-3.5 w-3.5" style={{ color: m.color }} />
                                  <span className="text-[12px] font-semibold">{m.name}</span>
                                  <span className="rounded border border-border px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                                    {a.phase === "resolution" ? "Resolution" : "Initial"}
                                  </span>
                                  {a.stance && <span className="ml-auto text-[10px] text-muted-foreground truncate">{a.stance}</span>}
                                </div>
                                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{a.reasoning || a.summary}</p>
                                {a.assumptions.length > 0 && (
                                  <div className="mt-2">
                                    <Disclosure title="Assumptions" icon={CircleDot} count={a.assumptions.length}>
                                      <ul className="space-y-1">
                                        {a.assumptions.map((x, i) => (
                                          <li key={i} className="flex items-start gap-2 text-[12px] text-muted-foreground">
                                            <CircleDot className="mt-0.5 h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
                                            <span>{x}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </Disclosure>
                                  </div>
                                )}
                                {a.red_flags.length > 0 && (
                                  <div className="mt-1.5">
                                    <Disclosure title="Red flags" icon={Gavel} count={a.red_flags.length} tone="var(--color-destructive)">
                                      <ul className="space-y-1">
                                        {a.red_flags.map((x, i) => (
                                          <li key={i} className="flex items-start gap-2 text-[12px] text-foreground">
                                            <Gavel className="mt-0.5 h-3 w-3 shrink-0 text-[color:var(--color-destructive)]" />
                                            <span>{x}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </Disclosure>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-[13px] text-muted-foreground">
                    Couldn't reach the agent mesh.{" "}
                    <button onClick={() => selected && runAnalysis(selected, selected.text)} className="text-foreground link-underline">
                      Retry
                    </button>
                  </div>
                )}
              </div>

              {/* Clause-scoped prompt — Cursor-style composer */}
              <form onSubmit={handlePrompt} className="border-t border-border bg-surface/70 p-3">
                <div className="rounded-xl border border-border bg-input/40 transition-colors focus-within:border-border-strong focus-within:ring-1 focus-within:ring-ring">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        runPrompt();
                      }
                    }}
                    disabled={loading}
                    rows={1}
                    placeholder={`Ask the agents about ${selected.ref}…`}
                    className="max-h-32 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
                    <button
                      type="button"
                      title="Agent mesh · all specialists"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Infinity className="h-3.5 w-3.5" />
                      Mesh
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                    <button
                      type="button"
                      title="Reasoning depth"
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      Auto
                      <ChevronDown className="h-3 w-3 opacity-60" />
                    </button>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        type="button"
                        title="Attach exhibit"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        title="Send"
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-30"
                      >
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </>
          )}
        </aside>
        </>
        )}
        </div>
      </div>

      {/* ── Status bar (IDE chrome) ── */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-surface px-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {deal.name.toLowerCase().replace(/\s+/g, "-")}
          </span>
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: meshLive ? "var(--color-foreground)" : "var(--color-muted-foreground)" }}
            />
            {health ? (meshLive ? "mesh: live" : "mesh: demo") : "mesh: offline"}
          </span>
          {loading && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> analyzing
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 font-mono">
          {selected && analysis && (
            <button
              onClick={jumpToHighestRisk}
              title="Jump to next flagged clause"
              className="flex items-center gap-1 rounded px-1 transition-colors hover:bg-accent"
              style={{ color: (TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color }}
            >
              TIER {analysis.classification.tier}
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
          {selected && <span>{selected.ref}</span>}
          <span>{deal.law}</span>
          <span>UTF-8</span>
        </div>
      </footer>

      {/* ── Sign-off modal ── */}
      {modalOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm" onClick={() => !signing && setModalOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Confirm decision — {selected.ref}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Logged to a tamper-evident audit trail (Cloud Logging / Firestore).</p>
              </div>
              <button onClick={() => !signing && setModalOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold capitalize text-foreground">
                  <Gavel className="h-3.5 w-3.5 text-muted-foreground" /> {posture}
                </span>
                {analysis && (
                  <span
                    className="rounded-md px-2 py-1 text-[11px] font-bold"
                    style={{
                      color: (TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color,
                      backgroundColor: `color-mix(in oklab, ${(TIER_STYLE[analysis.classification.tier] ?? TIER_STYLE[2]).color} 16%, transparent)`,
                    }}
                  >
                    TIER {analysis.classification.tier} · {analysis.classification.tier_label}
                  </span>
                )}
              </div>

              {/* Override notice — partner is deciding against the AI recommendation */}
              {analysis &&
                posture &&
                posture !== analysis.classification.recommended_posture && (
                  <div
                    className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
                    style={{
                      borderColor: "color-mix(in oklab, var(--color-destructive) 35%, var(--color-border))",
                    }}
                  >
                    <Gavel className="mt-px h-4 w-4 shrink-0 text-[color:var(--color-destructive)]" />
                    <span className="text-foreground">
                      <strong className="font-semibold">Supervisory override.</strong> You are
                      recording <span className="font-semibold capitalize">{posture}</span> against
                      the AI recommendation of{" "}
                      <span className="font-semibold capitalize">
                        {analysis.classification.recommended_posture}
                      </span>
                      . This is logged as an accountable override.
                    </span>
                  </div>
                )}
              <div>
                <label htmlFor="rationale" className="mb-1.5 flex items-center gap-1.5">
                  <PenLine className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Counsel rationale — required</span>
                </label>
                <textarea
                  id="rationale"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="Document the basis for this decision: accepted residual risk, conditions, negotiation strategy…"
                  className="w-full resize-none rounded-lg border border-border bg-input/50 px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button onClick={() => setModalOpen(false)} disabled={signing} className="rounded-lg border border-border px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSignoff} disabled={!rationale.trim() || signing} className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:opacity-90 disabled:opacity-50">
                {signing ? <>Signing <Loader2 className="h-3.5 w-3.5 animate-spin" /></> : <>Confirm &amp; sign off <CheckCircle2 className="h-3.5 w-3.5" /></>}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
