/* eslint-disable @next/next/no-img-element -- Supabase public URLs are configured at runtime. */

import { ImageIcon } from "lucide-react";

export function MediaThumbnail({ src, alt }: { src: string | null; alt: string }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border-strong bg-surface-muted text-muted">
      {src ? (
        <img src={src} alt={alt} className="size-full object-cover" />
      ) : (
        <ImageIcon aria-hidden="true" className="size-4" />
      )}
    </span>
  );
}
