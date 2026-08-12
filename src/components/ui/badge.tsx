import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/12 text-primary hover:bg-primary/18",
        solid: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/90",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/15 text-warning",
        secondary: "border-border/60 bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-destructive/25 bg-destructive/12 text-destructive",
        outline: "border-border/70 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
