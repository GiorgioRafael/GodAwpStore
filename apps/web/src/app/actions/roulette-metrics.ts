"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** 0% to 1000%: an item bought for R$ 1,00 and listed at R$ 11,00. */
const MAXIMUM_MARKUP_BPS = 100_000;
/** A provider that kept more than a fifth of every Pix would not be in use. */
const MAXIMUM_FEE_BPS = 2_000;

/**
 * The three rates the roulette runs on. Markup and provider fee only tell the
 * panel what a prize really cost; the resale share is different — it is read at
 * sale time, so lowering it takes value away from every prize already sitting
 * in somebody's inventory. The form says so out loud rather than hiding it.
 */
export async function saveRouletteRatesAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const markupBps = percentToBps(formData.get("markupPercent"));
  const feeBps = percentToBps(formData.get("feePercent"));
  const saleRateBps = percentToBps(formData.get("salePercent"));

  const fieldErrors: Record<string, string[]> = {};
  if (markupBps === null || markupBps > MAXIMUM_MARKUP_BPS) {
    fieldErrors.markupPercent = ["Informe de 0% a 1000%."];
  }
  if (feeBps === null || feeBps > MAXIMUM_FEE_BPS) {
    fieldErrors.feePercent = ["Informe de 0% a 20%."];
  }
  if (saleRateBps === null || saleRateBps > 10_000) {
    fieldErrors.salePercent = ["Informe de 0% a 100%."];
  }
  if (
    markupBps === null ||
    feeBps === null ||
    saleRateBps === null ||
    Object.keys(fieldErrors).length > 0
  ) {
    return { ok: false, message: "Revise as taxas da roleta.", fieldErrors };
  }

  try {
    await requireAdmin();
    const client = await createServerSupabaseClient();
    if (!client) throw new Error("Supabase não configurado.");

    const { data, error } = await client
      .from("platform_settings")
      .update({
        roulette_markup_bps: markupBps,
        livepix_fee_bps: feeBps,
        roulette_sale_rate_bps: saleRateBps,
      })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "Configurações globais não encontradas." };

    revalidatePath("/metricas-roleta");
    revalidatePath("/roleta");
    return { ok: true, message: "Premissas atualizadas." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:roleta:premissas] ${message}`);
    return { ok: false, message: "Não foi possível salvar as premissas agora." };
  }
}

/** Accepts "70", "70,5" and "70.5"; rejects anything that is not a number. */
function percentToBps(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}
