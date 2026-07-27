"use server";

import { STORE_SLUG } from "@/lib/brand";
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

/**
 * Feeds the OBS overlay. It runs without a session, so the shared token gates
 * it and only already-masked fields ever leave the server — the feed table
 * itself is unreachable from the browser key.
 */
export async function readRouletteOverlayEvents(
  token: string,
  sinceIso: string | null,
): Promise<RouletteOverlayFeedEvent[]> {
  if (STORE_SLUG !== "gwstore") return [];

  const configuredToken = process.env.ROULETTE_OVERLAY_TOKEN?.trim();
  // Fail closed: no configured token means no feed.
  if (!configuredToken || token !== configuredToken) return [];

  const client = createAdminSupabaseClient();
  if (!client) return [];

  let query = client
    .from("roulette_overlay_events")
    .select("id,prize_key,product_name,value_cents,masked_display_name,is_top_prize,created_at")
    .order("created_at", { ascending: true })
    .limit(MAXIMUM_EVENTS);
  query = sinceIso
    ? query.gt("created_at", sinceIso)
    : // A cold overlay starts from now instead of replaying the backlog.
      query.gte("created_at", new Date().toISOString());

  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error(`[roleta:overlay:feed] ${error.message}`);
    return [];
  }

  return data.map((event) => ({
    id: event.id,
    prizeKey: event.prize_key,
    productName: event.product_name,
    valueCents: event.value_cents,
    maskedDisplayName: event.masked_display_name,
    isTopPrize: event.is_top_prize,
    createdAt: event.created_at,
  }));
}
