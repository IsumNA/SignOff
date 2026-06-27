import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  Building2,
  Check,
  Gauge,
  LogOut,
  Mail,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import {
  getEval,
  getHealth,
  type EvalResult,
  type HealthResponse,
} from "@/lib/api";
import { getStoredTheme, setTheme, type Theme } from "@/lib/theme";
import { Brand } from "@/components/Brand";
import { Scales, Seal, Workstreams } from "@/components/icons";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "SignOff — Profile" },
      {
        name: "description",
        content: "Your account, supervision preferences and AI reviewer defaults.",
      },
    ],
  }),
  component: Profile,
});

// --- the signed-in partner (demo identity) ---
const USER = {
  initials: "RC",
  name: "Rob Clay",
  role: "M&A Partner",
  firm: "Clifford Chance",
  email: "rob.clay@cliffordchance.com",
  group: "Corporate / M&A",
  office: "London",
};

// --- preferences persisted locally so the toggles feel real in the demo ---
interface Prefs {
  notifyReady: boolean;
  notifyLowConfidence: boolean;
  requireTier3: boolean;
  threshold: number;
  escalationTier: number;
  reviewers: Record<string, boolean>;
  twoFactor: boolean;
}

const DEFAULT_PREFS: Prefs = {
  notifyReady: true,
  notifyLowConfidence: true,
  requireTier3: true,
  threshold: 80,
  escalationTier: 2,
  reviewers: {
    "NVIDIA Nemotron": true,
    "Google Gemini": true,
    Perplexity: true,
    "Claude 3.5 Sonnet": false,
  },
  twoFactor: true,
};

const PREFS_KEY = "signoff.profile.prefs";

const REVIEWERS: { name: string; role: string }[] = [
  { name: "NVIDIA Nemotron", role: "Confidential risk review" },
  { name: "Google Gemini", role: "Analysis & recommendations" },
  { name: "Perplexity", role: "Live legal research" },
  { name: "Claude 3.5 Sonnet", role: "Precedent drafting" },
];

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      reviewers: { ...DEFAULT_PREFS.reviewers, ...(parsed.reviewers ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
      style={{
        backgroundColor: on ? "var(--color-foreground)" : "var(--color-muted)",
      }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform"
        style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{title}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 px-3 py-3 text-center">
      <div className="font-serif text-[24px] font-medium leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

const pct = (v: number | null | undefined): string =>
  v == null ? "—" : `${Math.round(v * 100)}%`;

function Section({
  Icon,
  title,
  children,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card/30 p-6">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-serif text-[18px] font-medium tracking-[-0.01em]">{title}</h2>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Profile() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setPrefs(loadPrefs());
    setThemeState(getStoredTheme());
    getHealth().then(setHealth).catch(() => setHealth(null));
    getEval().then(setEvalResult).catch(() => setEvalResult(null));
  }, []);

  function chooseTheme(next: Theme) {
    setThemeState(next);
    setTheme(next);
  }

  // Persist on change and flash a "Saved" confirmation.
  function update(next: Partial<Prefs>) {
    setPrefs((prev) => {
      const merged = { ...prev, ...next };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
      } catch {
        /* ignore storage failures in the demo */
      }
      return merged;
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  function toggleReviewer(name: string) {
    update({ reviewers: { ...prefs.reviewers, [name]: !prefs.reviewers[name] } });
  }

  const reviewerMode = (name: string): "live" | "demo" | null => {
    if (!health) return null;
    const map: Record<string, string> = {
      "NVIDIA Nemotron": "nvidia_nim",
      "Google Gemini": "vertex_ai",
      Perplexity: "perplexity",
    };
    const key = map[name];
    if (!key) return null;
    return (health.integrations[key] as "live" | "demo") ?? null;
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* ── Topbar ── */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/60 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Brand />
          <span className="h-4 w-px bg-border" />
          <span className="truncate text-[13px] font-medium text-muted-foreground">Profile</span>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to matters
        </Link>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {/* Identity */}
          <div className="mb-8 flex items-center gap-5">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent text-[22px] font-semibold text-foreground">
              {USER.initials}
            </span>
            <div className="min-w-0">
              <h1 className="font-serif text-[30px] font-medium leading-tight tracking-[-0.02em]">
                {USER.name}
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {USER.role} · {USER.firm} · {USER.office}
              </p>
            </div>
            <span className="ml-auto hidden items-center gap-1.5 self-start rounded-full bg-[color:var(--color-foreground)]/10 px-2.5 py-1 text-[11px] font-medium text-foreground sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-success)]" />
              Signed in
            </span>
          </div>

          <div className="grid gap-5">
            {/* Account */}
            <Section Icon={UserRound} title="Account">
              <SettingRow title="Full name">
                <span className="text-[13px] text-muted-foreground">{USER.name}</span>
              </SettingRow>
              <SettingRow title="Email">
                <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" /> {USER.email}
                </span>
              </SettingRow>
              <SettingRow title="Role">
                <span className="text-[13px] text-muted-foreground">{USER.role}</span>
              </SettingRow>
              <SettingRow title="Firm">
                <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> {USER.firm}
                </span>
              </SettingRow>
              <SettingRow title="Practice group">
                <span className="text-[13px] text-muted-foreground">{USER.group}</span>
              </SettingRow>
            </Section>

            {/* Appearance */}
            <Section Icon={Palette} title="Appearance">
              <SettingRow
                title="Theme"
                hint="Switch between the dark workspace and a light layout."
              >
                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface/60 p-0.5">
                  {([
                    { id: "dark" as const, label: "Dark", Icon: Moon },
                    { id: "light" as const, label: "Light", Icon: Sun },
                  ]).map((opt) => {
                    const active = theme === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => chooseTheme(opt.id)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                          active
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <opt.Icon className="h-3.5 w-3.5" /> {opt.label}
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
            </Section>

            {/* Supervision preferences */}
            <Section Icon={Bell} title="Notifications">
              <SettingRow
                title="Tell me when a matter is ready to sign off"
                hint="Emails you the moment all checks clear and a matter awaits your signature."
              >
                <Toggle on={prefs.notifyReady} onChange={(v) => update({ notifyReady: v })} />
              </SettingRow>
              <SettingRow
                title="Alert me to low-confidence AI recommendations"
                hint="Flags anything the AI is unsure about so you can look more closely."
              >
                <Toggle
                  on={prefs.notifyLowConfidence}
                  onChange={(v) => update({ notifyLowConfidence: v })}
                />
              </SettingRow>
            </Section>

            {/* Sign-off defaults */}
            <Section Icon={Scales} title="Sign-off defaults">
              <SettingRow
                title="Always require my sign-off on critical (Tier 3) findings"
                hint="Critical findings can never be cleared automatically."
              >
                <Toggle on={prefs.requireTier3} onChange={(v) => update({ requireTier3: v })} />
              </SettingRow>
              <div className="py-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-foreground">
                    Default compliance threshold
                  </p>
                  <span className="font-mono text-[13px] tabular-nums text-foreground">
                    {prefs.threshold}%
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                  New matters below this score are flagged for your review.
                </p>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={prefs.threshold}
                  onChange={(e) => update({ threshold: Number(e.target.value) })}
                  className="mt-2.5 w-full accent-[color:var(--color-foreground)]"
                />
              </div>
              <div className="py-3.5">
                <p className="text-[13px] font-medium text-foreground">Escalate to me at</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                  Findings at or above this tier always come to you.
                </p>
                <div className="mt-2.5 flex gap-2">
                  {[1, 2, 3].map((t) => {
                    const active = prefs.escalationTier === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => update({ escalationTier: t })}
                        className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition ${
                          active
                            ? "border-border-strong bg-surface-elevated/60 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent/40"
                        }`}
                      >
                        Tier {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            {/* AI reviewer defaults */}
            <Section Icon={Workstreams} title="Default AI reviewers">
              {REVIEWERS.map((r) => {
                const mode = reviewerMode(r.name);
                const on = prefs.reviewers[r.name];
                return (
                  <SettingRow key={r.name} title={r.name} hint={r.role}>
                    <div className="flex items-center gap-3">
                      {mode && (
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                          style={{
                            color:
                              mode === "live"
                                ? "var(--color-foreground)"
                                : "var(--color-muted-foreground)",
                            backgroundColor:
                              mode === "live"
                                ? "color-mix(in oklab, var(--color-foreground) 12%, transparent)"
                                : "var(--color-muted)",
                          }}
                        >
                          {mode === "live" ? "Live" : "Demo"}
                        </span>
                      )}
                      <Toggle on={on} onChange={() => toggleReviewer(r.name)} />
                    </div>
                  </SettingRow>
                );
              })}
            </Section>

            {/* Measured model accuracy — reproducible benchmark */}
            {evalResult && (
              <Section Icon={Gauge} title="Model accuracy">
                {evalResult.available && evalResult.metrics ? (
                  <div className="py-3.5">
                    <div className="grid grid-cols-3 gap-3">
                      <Stat
                        label="Risk-level accuracy"
                        value={pct(evalResult.metrics.tier_accuracy)}
                      />
                      <Stat
                        label="Critical clauses caught"
                        value={pct(evalResult.metrics.escalation_recall)}
                      />
                      <Stat
                        label="Within one level"
                        value={pct(evalResult.metrics.adjacent_accuracy)}
                      />
                    </div>
                    <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
                      Measured on {evalResult.dataset_size} benchmark clauses with
                      lawyer-assigned risk levels
                      {evalResult.mode ? ` (${evalResult.mode} models)` : ""}.
                      “Critical clauses caught” is how often the review correctly
                      escalated the genuinely high-risk clauses — the number that
                      matters most for supervision.
                    </p>
                  </div>
                ) : (
                  <div className="py-3.5 text-[12px] leading-snug text-muted-foreground">
                    No benchmark recorded yet. Run{" "}
                    <code className="font-mono text-[11px]">python evaluate.py</code> in
                    the backend to measure and publish accuracy here.
                  </div>
                )}
              </Section>
            )}

            {/* Security & records */}
            <Section Icon={ShieldCheck} title="Security & records">
              <SettingRow
                title="Two-step sign-in"
                hint="Adds a second check when you sign in from a new device."
              >
                <Toggle on={prefs.twoFactor} onChange={(v) => update({ twoFactor: v })} />
              </SettingRow>
              <div className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                    <Seal className="h-3.5 w-3.5" /> Tamper-proof decision record
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    Every analysis, plan and sign-off you make is permanently recorded.
                  </p>
                </div>
                <Link
                  to="/audit"
                  className="shrink-0 text-[12px] font-medium text-foreground link-underline"
                >
                  View record
                </Link>
              </div>
            </Section>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <span
                className={`inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-opacity ${
                  saved ? "opacity-100" : "opacity-0"
                }`}
              >
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--color-destructive)]/40 px-4 py-2 text-[13px] font-semibold text-[color:var(--color-destructive)] transition hover:bg-[color:var(--color-destructive)]/10"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
