import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  WheelCandidate,
  WheelSlot,
} from "@/components/admin/roulette-wheel-editor";

export type RouletteWheelAdmin =
  | {
      ok: true;
      slots: WheelSlot[];
      candidates: WheelCandidate[];
      enabled: boolean;
    }
  | { ok: false; reason: string };

/**
 * Everything the wheel editor needs. A failure carries its reason: this is an
 * admin-only screen, and "could not load" with no cause leaves the operator
 * with nothing to act on and nothing to report.
 */
export async function getRouletteWheelAdmin(): Promise<RouletteWheelAdmin> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { ok: false, reason: "Supabase não está configurado." };

  const [wheel, candidates, settings] = await Promise.all([
    supabase.rpc("admin_roulette_wheel"),
    supabase.rpc("admin_roulette_prize_candidates"),
    supabase.from("platform_settings").select("roulette_enabled").eq("id", 1).maybeSingle(),
  ]);

  const failure = wheel.error ?? candidates.error;
  if (failure) {
    console.error(`[admin:roleta:roda] ${failure.code ?? "sem código"} ${failure.message}`);
    return {
      ok: false,
      reason: `${failure.code ?? "sem código"}: ${failure.message}`,
    };
  }

  return {
    ok: true,
    slots: (wheel.data ?? []).map((slot) => ({
      prizeKey: slot.slot_prize_key,
      productId: slot.slot_product_id ?? "",
      productName: slot.slot_product_name,
      valueCents: Number(slot.slot_value_cents) || 0,
      drawWeight: Number(slot.slot_draw_weight) || 0,
      stockQuantity: Number(slot.slot_stock_quantity) || 0,
      quantity: Math.max(Number(slot.slot_prize_quantity) || 1, 1),
      heldUnits: Number(slot.slot_held_units) || 0,
      // Won on this slice before it was repointed. Still owed, still sellable,
      // but not this product — folding the two into one number describes an
      // item that does not exist.
      retiredUnits: Number(slot.slot_retired_units) || 0,
      archived: Boolean(slot.slot_archived),
      // A product may remain in an old saved slot after it was deactivated in
      // the catalogue. It is intentionally absent from candidates, so expose
      // that state to the editor instead of rendering an empty select and only
      // explaining the rejection after the admin presses Save.
      available: (candidates.data ?? []).some(
        (candidate) => candidate.candidate_id === slot.slot_product_id,
      ),
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
