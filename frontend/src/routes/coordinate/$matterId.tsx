import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, Cpu, Loader2 } from "lucide-react";
import {
  getMatters,
  getTasks,
  type Matter,
  type Task,
  type TaskColumn,
  type TasksResponse,
} from "@/lib/api";
import { LifecycleStepper } from "@/components/Lifecycle";
import { Brand } from "@/components/Brand";
import { ReviewGlass, Scales } from "@/components/icons";

export const Route = createFileRoute("/coordinate/$matterId")({
  head: () => ({
    meta: [
      { title: "SignOff — Coordinate" },
      {
        name: "description",
        content: "Assign and sequence autonomous agents across a matter's workstreams.",
      },
    ],
  }),
  component: Coordinate,
});

const COLUMN_META: Record<TaskColumn, { label: string; color: string }> = {
  queued: { label: "Queued", color: "var(--color-muted-foreground)" },
  risk: { label: "Risk Agent", color: "var(--color-foreground)" },
  precedent: { label: "Precedent", color: "var(--color-foreground)" },
  research: { label: "Research", color: "var(--color-foreground)" },
  synthesis: { label: "Synthesis", color: "var(--color-foreground)" },
  counsel: { label: "Awaiting Counsel", color: "var(--color-foreground)" },
  signed: { label: "Signed", color: "var(--color-muted-foreground)" },
};

function tierColor(tier: number): string {
  if (tier >= 3) return "var(--color-destructive)";
  if (tier === 2) return "var(--color-foreground)";
  return "var(--color-muted-foreground)";
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const tc = tierColor(task.tier);
  return (
    <button
      onClick={onOpen}
      className="group block w-full rounded-lg border border-border bg-surface-elevated/50 p-3 text-left transition hover:border-border-strong hover:bg-surface-elevated"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{task.ref}</span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold"
          style={{ color: tc, backgroundColor: `color-mix(in oklab, ${tc} 16%, transparent)` }}
        >
          T{task.tier}
        </span>
      </div>
      <span className="mt-1 block text-[12.5px] font-semibold leading-snug text-foreground">
        {task.title}
      </span>
      {task.flagged && task.note && (
        <span className="mt-1.5 block text-[11px] leading-snug text-[color:var(--color-destructive)]">
          {task.note}
        </span>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <Cpu className="h-3 w-3" /> {task.agent}
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </div>
    </button>
  );
}

function Coordinate() {
  const { matterId } = Route.useParams();
  const navigate = useNavigate();
  const [board, setBoard] = useState<TasksResponse | null>(null);
  const [matter, setMatter] = useState<Matter | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getTasks(matterId).then(setBoard).catch(() => setError(true));
    getMatters()
      .then((r) => setMatter(r.matters.find((m) => m.id === matterId) ?? null))
      .catch(() => {});
  }, [matterId]);

  function openReview() {
    navigate({ to: "/matter/$matterId", params: { matterId } });
  }

  const name = board?.matter_name ?? matter?.name ?? matterId;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Topbar */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface/60 px-6 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link to="/">
            <Brand />
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-[13px] font-medium">{name}</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-muted-foreground">Coordinate</span>
        </div>
        <LifecycleStepper current="coordinate" matterId={matterId} compact />
      </header>

      {/* Sub-header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/30 px-6 py-3">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Ledger
          </Link>
          <div className="h-4 w-px bg-border" />
          <div className="min-w-0">
            <h1 className="font-serif text-[19px] font-medium tracking-[-0.01em]">Coordination board</h1>
            <p className="text-[11.5px] text-muted-foreground">
              Stage 2 — agents pick up workstreams and move them across the mesh.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {matter && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Scales className="h-3.5 w-3.5" /> {matter.compliance_envelope}% envelope
            </span>
          )}
          <button
            onClick={openReview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ReviewGlass className="h-3.5 w-3.5" /> Open Review workspace
          </button>
        </div>
      </div>

      {/* Board */}
      <main className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        {error ? (
          <div className="px-6 py-16 text-center text-[13px] text-muted-foreground">
            Couldn't load the board. Is the backend running on{" "}
            <code className="font-mono">/api/matters/{matterId}/tasks</code>?
          </div>
        ) : !board ? (
          <div className="flex items-center justify-center gap-2 px-6 py-20 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workstreams…
          </div>
        ) : (
          <div className="flex h-full gap-3 px-6 py-5">
            {board.columns.map((col) => {
              const meta = COLUMN_META[col];
              const cards = board.tasks.filter((t) => t.column === col);
              return (
                <div key={col} className="flex h-full w-[240px] shrink-0 flex-col">
                  <div className="mb-2.5 flex items-center justify-between px-1">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{cards.length}</span>
                  </div>
                  <div
                    className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-card/20 p-2 scrollbar-thin"
                    style={{ borderTop: `2px solid ${meta.color === "var(--color-muted-foreground)" ? "var(--color-border-strong)" : meta.color}` }}
                  >
                    {cards.length === 0 ? (
                      <span className="px-1 py-2 text-[11px] text-muted-foreground/60">—</span>
                    ) : (
                      cards.map((t) => (
                        <TaskCard key={t.id} task={t} onOpen={openReview} />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
