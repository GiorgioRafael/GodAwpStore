import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  WheelCandidate,
  WheelSlot,
} from "@/components/admin/roulette-wheel-editor";

export type RouletteWheelAdmin = {
  slots: WheelSlot[];
  candidates: WheelCandidate[];
  enabled: boolean;
};

/** Everything the wheel editor needs, or null when it cannot be read. */
export async function getRouletteWheelAdmin(): Promise<RouletteWheelAdmin | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const [wheel, candidates, settings] = await Promise.all([
    supabase.rpc("admin_roulette_wheel"),
    supabase.rpc("admin_roulette_prize_candidates"),
    supabase.from("platform_settings").select("roulette_enabled").eq("id", 1).maybeSingle(),
  ]);

  if (wheel.error || candidates.error) {
    console.error(
      `[admin:roleta:roda] ${wheel.error?.message ?? candidates.error?.message ?? "erro"}`,
    );
    return null;
  }

  return {
    slots: (wheel.data ?? []).map((slot) => ({
      prizeKey: slot.slot_prize_key,
      productId: slot.slot_product_id ?? "",
      productName: slot.slot_product_name,
      valueCents: Number(slot.slot_value_cents) || 0,
      drawWeight: Number(slot.slot_draw_weight) || 0,
      stockQuantity: Number(slot.slot_stock_quantity) || 0,
      heldUnits: Number(slot.slot_held_units) || 0,
      archived: Boolean(slot.slot_archived),
    })),
    candidates: (candidates.data ?? []).map((candidate) => ({
      id: candidate.candidate_id,
      name: candidate.candidate_name,
      valueCents: Number(candidate.candidate_value_cents) || 0,
      stockQuantity: Number(candidate.candidate_stock_quantity) || 0,
    })),
    // A missing settings row means nothing has been configured; the wheel
    // running is the safer read, because pausing it silently would look like a
    // bug to every player mid-spin.
    enabled: settings.data?.roulette_enabled ?? true,
  };
}
