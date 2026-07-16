"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";

import type { AdminActionState } from "@/app/actions/admin";
import { cn } from "@/components/ui/cn";

export const initialAdminActionState: AdminActionState = {
  ok: false,
  message: "",
};

export function fieldError(state: AdminActionState, name: string): string | undefined {
  return state.fieldErrors?.[name]?.[0];
}

export function ActionFeedback({
  state,
  className,
}: {
  state: AdminActionState;
  className?: string;
}) {
  if (!state.message) return null;

  const Icon = state.ok ? CheckCircle2 : CircleAlert;

  return (
    <div
      role={state.ok ? "status" : "alert"}
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-5",
        state.ok
          ? "border-success/25 bg-success/[0.07] text-[#a7ebc0]"
          : "border-danger/25 bg-danger/[0.07] text-[#ffc0bd]",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{state.message}</span>
    </div>
  );
}
