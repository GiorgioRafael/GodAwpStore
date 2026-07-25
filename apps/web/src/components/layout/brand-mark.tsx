import Image from "next/image";

import defaultStoreLogo from "@/app/icon.png";
import { cn } from "@/components/ui/cn";
import {
  STORE_INITIALS,
  STORE_LOGO_URL,
  USE_DEFAULT_STORE_LOGO,
} from "@/lib/brand";

export function BrandMark({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  if (STORE_LOGO_URL) {
    return (
      // The logo is public, browser-loaded branding configured per deployment.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={STORE_LOGO_URL}
        alt=""
        className={cn("size-full object-cover", className)}
      />
    );
  }

  if (USE_DEFAULT_STORE_LOGO) {
    return (
      <Image
        src={defaultStoreLogo}
        alt=""
        width={1254}
        height={1254}
        className={cn("size-full object-cover", className)}
        sizes="96px"
        priority={priority}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(244,114,182,.55),transparent_38%),linear-gradient(145deg,#09090b,#3b0764_58%,#701a75)] px-1 text-center text-[.34em] font-black tracking-[-0.04em] text-white",
        className,
      )}
    >
      {STORE_INITIALS}
    </span>
  );
}
