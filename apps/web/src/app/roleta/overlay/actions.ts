"use server";

import { ROULETTE_AVAILABLE } from "@/lib/roulette/availability";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const MAXIMUM_EVENTS = 20;

export type RouletteOverlayFeedEvent = {
  id: string;
  prizeKey: string;
  productName: string;
  valueCents: number;
  maskedDisplayName: string;
  isTopPrize: boolean;
  createdAt: string;
};

export type RouletteOverlayFeed = {
  events: RouletteOverlayFeedEvent[];
  /**
   * Where the next poll must resume. The server always answers with its own
   * clock, so an empty round still advances the cursor and a spin that lands
   * between two polls is never skipped.
   */
  cursor: string;
};

/**
 * Feeds the OBS overlay. It runs without a session, so the shared token gates
 * it and only already-masked fields ever leave the server — the feed table
 * itself is unreachable from the browser key.
 */
export async function readRouletteOverlayEvents(
  token: string,
  sinceIso: string | null,
): Promise<RouletteOverlayFeed> {
  const now = new Date().toISOString();
  if (!ROULETTE_AVAILABLE) return { events: [], cursor: now };

  const configuredToken = process.env.ROULETTE_OVERLAY_TOKEN?.trim();
  // Fail closed: no configured token means no feed.
  if (!configuredToken || token !== configuredToken) return { events: [], cursor: now };

  const client = createAdminSupabaseClient();
  if (!client) return { events: [], cursor: now };

  // A cold overlay starts from the server clock instead of replaying the
  // backlog, and every later round resumes strictly after the last cursor.
  const since = sinceIso ?? now;
  const { data, error } = await client
    .from("roulette_overlay_events")
    .select("id,prize_key,product_name,value_cents,masked_display_name,is_top_prize,created_at")
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(MAXIMUM_EVENTS);
  if (error || !data) {
    if (error) console.error(`[roleta:overlay:feed] ${error.message}`);
    // Keep the caller's place so a transient failure does not skip a spin.
    return { events: [], cursor: since };
  }

  const events = data.map((event) => ({
    id: event.id,
    prizeKey: event.prize_key,
    productName: event.product_name,
    valueCents: event.value_cents,
    maskedDisplayName: event.masked_display_name,
    isTopPrize: event.is_top_prize,
    createdAt: event.created_at,
  }));

  return {
    events,
    cursor: events.length ? events[events.length - 1].createdAt : since,
  };
}
