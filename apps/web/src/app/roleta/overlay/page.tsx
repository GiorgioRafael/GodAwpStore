import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RouletteOverlay } from "@/components/roulette/roulette-overlay";
import { STORE_SLUG } from "@/lib/brand";
import {
  buildRouletteWheelPrizes,
  normalizeRoulettePrizeProducts,
} from "@/lib/roulette/demo";
import {
  OVERLAY_BACKGROUNDS,
  OVERLAY_BACKGROUND_PARAM,
  OVERLAY_QUEUE_PARAM,
  normalizeOverlayBackground,
  normalizeOverlayQueueLimit,
} from "@/lib/roulette/overlay-queue";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Overlay da roleta",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Transparent overlay for OBS or a captured browser window. It runs without a
 * session, so the page is gated by ROULETTE_OVERLAY_TOKEN and the live feed it
 * subscribes to carries only masked names.
 */
export default async function RouletteOverlayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (STORE_SLUG !== "gwstore") notFound();

  const configuredToken = process.env.ROULETTE_OVERLAY_TOKEN?.trim();
  const query = await searchParams;
  const token = single(query.token);
  // Fail closed: without a configured token the overlay stays unreachable.
  if (!configuredToken || !token || token !== configuredToken) notFound();

  const prizes = buildRouletteWheelPrizes(await readOverlayPrizes());
  const queueLimit = normalizeOverlayQueueLimit(single(query[OVERLAY_QUEUE_PARAM]));
  const background = normalizeOverlayBackground(single(query[OVERLAY_BACKGROUND_PARAM]));

  return (
    <>
      {/*
        The store paints `body { background: var(--background) }`, which is what
        made the overlay show up black in OBS. A Browser Source composites the
        page with alpha, so clearing it here is all transparency needs — no
        chroma key, no filter. The other values exist for captures that flatten
        alpha, like a window capture in TikTok Studio.
      */}
      <style>{`html,body{background:${OVERLAY_BACKGROUNDS[background]} !important;}`}</style>
      <RouletteOverlay prizes={prizes} token={token} queueLimit={queueLimit} />
    </>
  );
}

async function readOverlayPrizes() {
  const client = createAdminSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("roulette_prize_products")
    .select("prize_key,draw_weight,products(id,name,image_url,minimum_price_cents,archived_at)")
    .order("prize_key");
  if (error || !data) {
    if (error) console.error(`[roleta:overlay] ${error.message}`);
    return [];
  }

  return normalizeRoulettePrizeProducts(
    data.flatMap((slot) =>
      slot.products && !slot.products.archived_at
        ? [
            {
              slot_prize_key: slot.prize_key,
              slot_product_id: slot.products.id,
              slot_product_name: slot.products.name,
              slot_product_image_url: slot.products.image_url,
              slot_value_cents: slot.products.minimum_price_cents,
              slot_sale_value_cents: 0,
              slot_draw_chance_bps: 0,
            },
          ]
        : [],
    ),
  );
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
