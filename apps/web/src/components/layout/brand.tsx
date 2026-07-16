import Link from "next/link";
import { Crown } from "lucide-react";
import { cn } from "@/components/ui/cn";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-3 rounded-xl focus-visible:outline-none",
        compact && "gap-2",
      )}
      aria-label="GodAwpStore — início"
    >
      <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-gold/35 bg-gradient-to-br from-gold/20 via-gold/5 to-transparent text-gold-bright shadow-gold">
        <Crown aria-hidden="true" className="size-[19px]" strokeWidth={1.8} />
        <span className="absolute inset-x-2 bottom-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">
            GodAwpStore
          </span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
            Admin console
          </span>
        </span>
      ) : null}
    </Link>
  );
}
