"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/components/ui/cn";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type LivePhase = "connecting" | "live" | "refreshing" | "updated" | "reconnecting";

const PHASE_LABELS: Record<LivePhase, string> = {
  connecting: "Conectando",
  live: "Ao vivo",
  refreshing: "Atualizando",
  updated: "Atualizado agora",
  reconnecting: "Reconectando",
};

export function AdminLiveRefresh() {
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabaseClient());
  const [phase, setPhase] = useState<LivePhase>(() => (supabase ? "connecting" : "reconnecting"));
  const [isPending, startTransition] = useTransition();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    let active = true;
    let connected = false;
    let debounceTimer: number | undefined;
    let updatedTimer: number | undefined;
    lastRefreshAt.current = Date.now();

    const refresh = () => {
      if (!active || document.visibilityState === "hidden") return;
      lastRefreshAt.current = Date.now();
      setPhase("updated");
      startTransition(() => router.refresh());
      window.clearTimeout(updatedTimer);
      updatedTimer = window.setTimeout(() => {
        if (active) setPhase(connected ? "live" : "reconnecting");
      }, 3_000);
    };

    const scheduleRefresh = () => {
      if (!active) return;
      setPhase("refreshing");
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(refresh, 600);
    };

    const channel = supabase
      ? supabase
          .channel("admin-orders-live-refresh")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "orders" },
            scheduleRefresh,
          )
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "orders" },
            scheduleRefresh,
          )
          .subscribe((status) => {
            if (!active) return;
            if (status === "SUBSCRIBED") {
              connected = true;
              setPhase("live");
            } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
              connected = false;
              setPhase("reconnecting");
            }
          })
      : null;

    const fallbackTimer = window.setInterval(refresh, 30_000);
    const refreshOnFocus = () => {
      if (Date.now() - lastRefreshAt.current >= 5_000) scheduleRefresh();
    };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refreshOnFocus();
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);

    return () => {
      active = false;
      window.clearTimeout(debounceTimer);
      window.clearTimeout(updatedTimer);
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [router, supabase]);

  const visiblePhase = isPending ? "refreshing" : phase;

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-success/20 bg-success/[0.06] px-3 py-1.5 text-xs text-muted-strong md:flex"
      aria-live="polite"
      aria-label={`Painel interno: ${PHASE_LABELS[visiblePhase]}`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          visiblePhase === "reconnecting"
            ? "bg-warning shadow-[0_0_8px_rgba(228,173,85,.7)]"
            : "bg-success shadow-[0_0_8px_rgba(101,201,139,.8)]",
          visiblePhase === "connecting" || visiblePhase === "refreshing" ? "animate-pulse" : "",
        )}
      />
      <span>Painel interno · {PHASE_LABELS[visiblePhase]}</span>
    </div>
  );
}
