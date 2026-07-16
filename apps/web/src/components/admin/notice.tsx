import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-gold/20 bg-gold/[0.055] px-4 py-3 text-sm leading-6 text-muted-strong">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold" />
      <div>{children}</div>
    </div>
  );
}
