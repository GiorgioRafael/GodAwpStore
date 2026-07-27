import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RouletteOverlay } from "@/components/roulette/roulette-overlay";
import { STORE_SLUG } from "@/lib/brand";
import {
  buildRouletteWheelPrizes,
  normalizeRoulettePrizeProducts,
} from "@/lib/roulette/demo";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Overlay da roleta",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const DEFAULT_QUEUE_LIMIT = 8;

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
  const queueLimit = readQueueLimit(single(query.fila));

  return <RouletteOverlay prizes={prizes} token={token} queueLimit={queueLimit} />;
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

function readQueueLimit(value: string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50
    ? parsed
    : DEFAULT_QUEUE_LIMIT;
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
