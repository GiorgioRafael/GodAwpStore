import Image from "next/image";
import Link from "next/link";
import gwStoreLogo from "@/app/icon.png";
import { cn } from "@/components/ui/cn";

export function Brand({
  compact = false,
  prominent = false,
}: {
  compact?: boolean;
  prominent?: boolean;
}) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-3 rounded-xl focus-visible:outline-none",
        compact && "gap-2",
        prominent && "flex-col gap-3 text-center",
      )}
      aria-label="GWStore — início"
    >
      <span
        className={cn(
          "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-fuchsia-400/35 bg-black shadow-[0_0_22px_rgba(217,70,239,.2)]",
          prominent &&
            "size-24 rounded-3xl border-fuchsia-300/45 shadow-[0_0_42px_rgba(217,70,239,.28)]",
        )}
      >
        <Image
          src={gwStoreLogo}
          alt=""
          width={1254}
          height={1254}
          className="size-full object-cover"
          sizes={prominent ? "96px" : "40px"}
          priority={prominent}
        />
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">
            GWStore
          </span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
            Admin console
          </span>
        </span>
      ) : null}
    </Link>
  );
}
