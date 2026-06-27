import { Link } from "@tanstack/react-router";

/**
 * The single source of truth for the SignOff wordmark.
 *
 * A serif wordmark (legal gravity) paired with a drawn signature stroke that
 * sits on a baseline — the literal act the product is named for. Monochrome,
 * no gradients, identical across every screen. Clicking it returns to the
 * Multi-Matter Ledger (home).
 */
export function Brand({ className = "", to = "/" }: { className?: string; to?: string }) {
  return (
    <Link
      to={to}
      aria-label="SignOff — back to the ledger"
      className={`flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border-strong bg-card">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-foreground"
          aria-hidden="true"
        >
          <path
            className="animate-sign"
            d="M3 14c1.6 0 1.9-7 3.2-7s.9 6.2 2.1 6.2 1.1-3.6 2.4-3.6 1 2.8 2.1 2.8 1.4-1.9 2.7-1.9"
          />
          <path d="M3 18.5h18" />
        </svg>
      </span>
      <span className="font-serif text-[19px] font-medium leading-none tracking-[-0.01em] text-foreground">
        SignOff
      </span>
    </Link>
  );
}
