import { Link } from "@tanstack/react-router";
import { Check, ClipboardList, Network, ScanSearch, FileSignature } from "lucide-react";
import type { MatterStage } from "@/lib/api";

const STAGES: {
  id: MatterStage;
  label: string;
  Icon: typeof ClipboardList;
}[] = [
  { id: "plan", label: "Plan", Icon: ClipboardList },
  { id: "coordinate", label: "Coordinate", Icon: Network },
  { id: "review", label: "Review", Icon: ScanSearch },
  { id: "signoff", label: "Sign Off", Icon: FileSignature },
];

const ORDER: MatterStage[] = ["plan", "coordinate", "review", "signoff"];

function stageHref(stage: MatterStage, matterId?: string): string | null {
  if (stage === "plan") return "/plan";
  if (!matterId) return null;
  if (stage === "coordinate") return `/coordinate/${matterId}`;
  return `/matter/${matterId}`; // review + sign off both live in the workspace
}

/**
 * The supervision spine: Plan → Coordinate → Review → Sign Off.
 * Rendered across every lifecycle screen so the workflow is always legible.
 */
export function LifecycleStepper({
  current,
  matterId,
  compact = false,
}: {
  current: MatterStage;
  matterId?: string;
  compact?: boolean;
}) {
  const currentIdx = ORDER.indexOf(current);

  return (
    <nav
      aria-label="Supervision lifecycle"
      className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin"
    >
      {STAGES.map((s, i) => {
        const state =
          i < currentIdx ? "done" : i === currentIdx ? "active" : "upcoming";
        const color =
          state === "active"
            ? "var(--color-foreground)"
            : state === "done"
              ? "var(--color-success)"
              : "var(--color-muted-foreground)";
        const href = stageHref(s.id, matterId);
        const Icon = s.Icon;

        const inner = (
          <span
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
              state === "active"
                ? "bg-card"
                : href
                  ? "hover:bg-card/60"
                  : ""
            }`}
            style={{ color }}
          >
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={{
                backgroundColor:
                  state === "upcoming"
                    ? "transparent"
                    : `color-mix(in oklab, ${color} 18%, transparent)`,
                border: state === "upcoming" ? `1px solid ${color}` : "none",
              }}
            >
              {state === "done" ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
            </span>
            {!compact && s.label}
          </span>
        );

        return (
          <span key={s.id} className="flex items-center gap-1.5">
            {href && state !== "upcoming" ? (
              <Link to={href}>{inner}</Link>
            ) : (
              inner
            )}
            {i < STAGES.length - 1 && (
              <span
                className="h-px w-4 shrink-0"
                style={{
                  background:
                    i < currentIdx
                      ? "var(--color-success)"
                      : "var(--color-border-strong)",
                }}
              />
            )}
          </span>
        );
      })}
    </nav>
  );
}
