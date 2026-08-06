import { cn } from "@/lib/utils";

/**
 * ZYRONEX brand mark: a circuit-built "X" with neon gradient nodes.
 * Rendered as inline SVG so it inherits sizing and works in both themes.
 */
export function ZyronexMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("size-9", className)}
    >
      <defs>
        <linearGradient id="zx-mark" x1="4" y1="60" x2="60" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="oklch(0.62 0.22 300)" />
          <stop offset="55%" stopColor="oklch(0.66 0.19 265)" />
          <stop offset="100%" stopColor="oklch(0.78 0.14 205)" />
        </linearGradient>
      </defs>
      <g
        stroke="url(#zx-mark)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* main X strokes */}
        <path d="M16 14 L48 50" />
        <path d="M48 14 L16 50" />
        {/* circuit branches */}
        <path d="M16 14 L16 8" />
        <path d="M48 50 L48 56" />
        <path d="M30 30 L40 30 L46 24" />
        <path d="M34 34 L24 34 L18 40" />
        <path d="M52 20 L58 20" strokeWidth="3" />
        <path d="M6 44 L12 44" strokeWidth="3" />
      </g>
      <g fill="url(#zx-mark)">
        <circle cx="16" cy="7" r="3" />
        <circle cx="48" cy="57" r="3" />
        <circle cx="47" cy="23" r="2.6" />
        <circle cx="17" cy="41" r="2.6" />
        <circle cx="59" cy="20" r="2.2" />
        <circle cx="5" cy="44" r="2.2" />
      </g>
    </svg>
  );
}

export function ZyronexLogo({
  className,
  size = "md",
  showTagline = false,
  tagline,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  tagline?: string;
}) {
  const mark = size === "lg" ? "size-11" : size === "sm" ? "size-8" : "size-9";
  const word =
    size === "lg" ? "text-3xl" : size === "sm" ? "text-lg" : "text-2xl";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <ZyronexMark className={mark} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-display font-extrabold uppercase tracking-[0.14em] text-foreground",
            word,
          )}
        >
          Zyronex
        </span>
        {showTagline && tagline && (
          <span className="mt-1.5 text-[0.62rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {tagline}
          </span>
        )}
      </span>
    </span>
  );
}
