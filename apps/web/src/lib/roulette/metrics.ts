import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type RouletteMetrics = {
  depositCount: number;
  depositGrossCents: number;
  depositPayerCount: number;
  providerFeeCents: number;
  coinLiabilityCents: number;
  spinCount: number;
  spinnerCount: number;
  coinsSpentCents: number;
  awardedValueCents: number;
  soldUnitCount: number;
  soldCreditedCents: number;
  redeemedUnitCount: number;
  redeemedValueCents: number;
  deliveredUnitCount: number;
  deliveredValueCents: number;
  pendingRedemptionCount: number;
  heldUnitCount: number;
  heldValueCents: number;
  deliveredCostCents: number;
  pendingCostCents: number;
  heldCostCents: number;
  netProfitCents: number;
  markupBps: number;
  feeBps: number;
  saleRateBps: number;
};

/**
 * Roulette-only result. It never reads orders or ledger_entries, so the numbers
 * here can be compared with the store revenue without double counting, and the
 * function behind it already leaves administrator testing out.
 */
export async function getRouletteMetrics(): Promise<RouletteMetrics | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("admin_roulette_metrics");
  const row = data?.[0];
  if (error || !row) {
    if (error) console.error(`[admin:roleta:metricas] ${error.message}`);
    return null;
  }

  return {
    depositCount: count(row.deposit_count),
    depositGrossCents: count(row.deposit_gross_cents),
    depositPayerCount: count(row.deposit_payer_count),
    providerFeeCents: count(row.provider_fee_cents),
    coinLiabilityCents: count(row.coin_liability_cents),
    spinCount: count(row.spin_count),
    spinnerCount: count(row.spinner_count),
    coinsSpentCents: count(row.coins_spent_cents),
    awardedValueCents: count(row.awarded_value_cents),
    soldUnitCount: count(row.sold_unit_count),
    soldCreditedCents: count(row.sold_credited_cents),
    redeemedUnitCount: count(row.redeemed_unit_count),
    redeemedValueCents: count(row.redeemed_value_cents),
    deliveredUnitCount: count(row.delivered_unit_count),
    deliveredValueCents: count(row.delivered_value_cents),
    pendingRedemptionCount: count(row.pending_redemption_count),
    heldUnitCount: count(row.held_unit_count),
    heldValueCents: count(row.held_value_cents),
    deliveredCostCents: count(row.delivered_cost_cents),
    pendingCostCents: count(row.pending_cost_cents),
    heldCostCents: count(row.held_cost_cents),
    netProfitCents: Number(row.net_profit_cents) || 0,
    markupBps: count(row.markup_bps),
    feeBps: count(row.fee_bps),
    saleRateBps: count(row.sale_rate_bps),
  };
}

/** Realised return: value handed out per coin spun. */
export function realisedReturnBps(metrics: RouletteMetrics) {
  if (metrics.coinsSpentCents <= 0) return null;
  return Math.round((metrics.awardedValueCents / metrics.coinsSpentCents) * 10000);
}

/** Cash already banked, minus the cost of everything still owed to players. */
export function worstCaseProfitCents(metrics: RouletteMetrics) {
  return metrics.netProfitCents - metrics.pendingCostCents - metrics.heldCostCents;
}

/** How the prizes a spin created ended up, as shares of the units won. */
export function prizeOutcomeShares(metrics: RouletteMetrics) {
  const total =
    metrics.soldUnitCount + metrics.redeemedUnitCount + metrics.heldUnitCount;
  if (total <= 0) return null;
  return {
    total,
    soldBps: Math.round((metrics.soldUnitCount / total) * 10000),
    redeemedBps: Math.round((metrics.redeemedUnitCount / total) * 10000),
    heldBps: Math.round((metrics.heldUnitCount / total) * 10000),
  };
}

/**
 * Administrator spins never reach these numbers, so a store where only the team
 * has tested the wheel reads as untouched instead of as a wall of zeros.
 */
export function hasPlayerActivity(metrics: RouletteMetrics) {
  return metrics.spinCount > 0 || metrics.depositCount > 0;
}

function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}
