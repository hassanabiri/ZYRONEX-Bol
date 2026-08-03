import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/** Read-only or interactive 5-star rating control. */
export function RatingStars({
  value,
  onChange,
  size = "sm",
}: {
  value: number;
  onChange?: (next: number) => void;
  size?: "sm" | "md";
}) {
  const dimension = size === "md" ? "size-5" : "size-3.5";
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= Math.round(value);
        const icon = (
          <Star
            className={cn(
              dimension,
              filled ? "fill-primary text-primary" : "text-muted-foreground/50",
            )}
          />
        );
        return onChange ? (
          <button key={star} type="button" onClick={() => onChange(star)} aria-label={`${star}`}>
            {icon}
          </button>
        ) : (
          <span key={star}>{icon}</span>
        );
      })}
    </span>
  );
}
