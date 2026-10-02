import * as React from "react";
import { cn } from "./cn";

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-muted-strong">
          {label}
        </label>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputStyles =
  "h-11 w-full rounded-xl border border-border-strong bg-surface-muted px-3.5 text-sm text-foreground placeholder:text-muted/65 transition-colors hover:border-[#4a473b] focus:border-gold/70 focus:outline-none focus:ring-2 focus:ring-gold/15 disabled:cursor-not-allowed disabled:opacity-55";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputStyles, className)} {...props} />
  ),
);

Input.displayName = "Input";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, style, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(inputStyles, "appearance-none pr-10", className)}
    style={{
      backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239b998e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      backgroundRepeat: "no-repeat", backgroundPosition: "right 0.85rem center", backgroundSize: "1rem",
      ...style,
    }}
    {...props}
  />
));

Select.displayName = "Select";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(inputStyles, "min-h-28 resize-y py-3", className)}
    {...props}
  />
));

Textarea.displayName = "Textarea";
