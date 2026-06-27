/**
 * The single source of truth for the SignOff wordmark.
 * Deliberately restrained: a monochrome check mark (sign-off) + one wordmark,
 * no gradients, used identically across every screen.
 */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-foreground text-background">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold leading-none tracking-[-0.01em] text-foreground">
        SignOff
      </span>
    </span>
  );
}
