import { Link } from "@tanstack/react-router";
import logoUrl from "@/assets/brand-logo.png";

/**
 * The single source of truth for the SignOff wordmark.
 *
 * The infinity-and-check mark paired with a serif wordmark (legal gravity).
 * The mark is rendered as a CSS mask filled with the theme foreground colour,
 * so it stays crisp and correctly contrasted in both dark and light themes
 * with no gradients. Clicking it returns to the Multi-Matter Ledger (home).
 */
export function Brand({ className = "", to = "/" }: { className?: string; to?: string }) {
  return (
    <Link
      to={to}
      aria-label="SignOff — back to the ledger"
      className={`flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    >
      <span
        aria-hidden="true"
        className="block h-6 w-10 shrink-0 bg-foreground"
        style={{
          WebkitMaskImage: `url(${logoUrl})`,
          maskImage: `url(${logoUrl})`,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
      <span className="font-serif text-[19px] font-medium leading-none tracking-[-0.01em] text-foreground">
        SignOff
      </span>
    </Link>
  );
}
