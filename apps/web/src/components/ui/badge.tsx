import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badgeStyles = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-white/[0.035] text-muted-strong",
        gold: "border-gold/30 bg-gold/10 text-gold-bright",
        success: "border-success/30 bg-success/10 text-[#94e5b2]",
        warning: "border-warning/30 bg-warning/10 text-[#f3c878]",
        danger: "border-danger/30 bg-danger/10 text-[#ffaaa7]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeStyles> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}
