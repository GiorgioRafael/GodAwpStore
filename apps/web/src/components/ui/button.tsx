import * as React from "react";
import Link, { type LinkProps } from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

export const buttonStyles = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-bright/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "border border-gold/55 bg-gold text-[#171208] shadow-gold hover:bg-gold-bright hover:border-gold-bright",
        secondary:
          "border border-border-strong bg-surface-elevated text-foreground hover:border-gold-muted hover:bg-[#1d1c17]",
        ghost: "text-muted-strong hover:bg-white/[0.05] hover:text-foreground",
        danger:
          "border border-danger/35 bg-danger/10 text-[#ffaaa7] hover:bg-danger/20",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-[15px]",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";

type LinkButtonProps = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  VariantProps<typeof buttonStyles>;

export function LinkButton({
  className,
  variant,
  size,
  ...props
}: LinkButtonProps) {
  return (
    <Link className={cn(buttonStyles({ variant, size }), className)} {...props} />
  );
}
