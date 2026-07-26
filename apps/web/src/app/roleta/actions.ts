"use server";

import { redirect } from "next/navigation";

import { extractDiscordIdentity, type AdminIdentity } from "@/lib/auth-identity";
import { getAdminSession } from "@/lib/auth";
import { STORE_SLUG } from "@/lib/brand";
import { getSiteUrl } from "@/lib/env";
import {
  isDemoRoulettePrizeKey,
  type DemoRoulettePrizeKey,
} from "@/lib/roulette/demo";
import { getRouletteSpinPaymentService } from "@/lib/roulette/runtime";
import type { RouletteSpinChargeStatus } from "@/lib/roulette/spin-payment";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SpinRouletteResult =
  | {
      ok: true;
      prizeKey: DemoRoulettePrizeKey;
      inventoryQuantity: number;
      spinId: string;
    }
  | { ok: false; message: string };

export type RouletteSpinChargeResult =
  | {
      ok: true;
      chargeId: string;
      status: RouletteSpinChargeStatus;
      checkoutUrl: string | null;
      amountCents: number;
    }
  | { ok: false; message: string };

export type RouletteSpinChargeStatusResult =
  | { ok: true; chargeId: string; status: RouletteSpinChargeStatus }
  | { ok: false; message: string };

/**
 * Opens (or reuses) the R$ 1,00 LivePix charge that authorizes one spin. A
 * charge that was already paid and never spun comes back untouched so nobody
 * pays twice for the same wheel.
 */
export async function startRouletteSpinPayment(): Promise<RouletteSpinChargeResult> {
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };
  const { supabase, identity } = session;

  const { data, error } = await supabase.rpc("start_roulette_spin_charge", {
    p_discord_user_id: identity.discordId,
  });
  const charge = data?.[0];
  if (error || !charge) {
    console.error(`[roleta:charge] ${error?.message ?? "cobrança não criada"}`);
    return { ok: false, message: "Não foi possível abrir o Pix do giro. Tente novamente." };
  }
  if (charge.charge_status === "paid") {
    return {
      ok: true,
      chargeId: charge.charge_id,
      status: "paid",
      checkoutUrl: charge.checkout_url,
      amountCents: charge.amount_cents,
    };
  }
  if (charge.charge_status !== "awaiting_payment") {
    return { ok: false, message: "Este giro não está mais disponível. Recarregue a página." };
  }

  try {
    const checkout = await getRouletteSpinPaymentService().createCheckout(
      charge.charge_id,
      getSiteUrl(),
    );
    return {
      ok: true,
      chargeId: charge.charge_id,
      status: "awaiting_payment",
      checkoutUrl: checkout.checkoutUrl,
      amountCents: charge.amount_cents,
    };
  } catch (error) {
    console.error(`[roleta:checkout] ${error instanceof Error ? error.message : "erro desconhecido"}`);
    return { ok: false, message: "O Pix do giro não pôde ser gerado agora. Tente novamente." };
  }
}

/**
 * Reports whether the spin was already paid. The LivePix webhook is the primary
 * confirmation; this also pulls the provider directly, rate limited in the
 * database, so a delayed webhook never strands a paid spin.
 */
export async function getRouletteSpinPaymentStatus(
  chargeId: string,
): Promise<RouletteSpinChargeStatusResult> {
  if (!UUID_PATTERN.test(chargeId)) {
    return { ok: false, message: "Giro inválido." };
  }
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };
  const { supabase } = session;

  const { data, error } = await supabase.rpc("get_roulette_spin_charge", {
    p_charge_id: chargeId,
  });
  const charge = data?.[0];
  if (error || !charge) {
    return { ok: false, message: "Giro não encontrado. Abra um novo Pix." };
  }
  if (charge.charge_status !== "awaiting_payment") {
    return { ok: true, chargeId: charge.charge_id, status: charge.charge_status };
  }

  try {
    const confirmation = await getRouletteSpinPaymentService().pullPendingPayment(chargeId);
    if (confirmation) {
      return { ok: true, chargeId: confirmation.chargeId, status: confirmation.status };
    }
  } catch (error) {
    // The webhook still owns the authoritative confirmation; a failed pull only
    // means this poll learned nothing new.
    console.error(`[roleta:pull] ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }

  return { ok: true, chargeId: charge.charge_id, status: "awaiting_payment" };
}

/**
 * Spins the wheel. Regular players consume the paid charge; administrators
 * listed in ADMIN_DISCORD_IDS spin for free for internal testing.
 */
export async function spinRoulette(chargeId: string | null): Promise<SpinRouletteResult> {
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };
  const { supabase, identity } = session;

  const admin = await isRouletteAdmin();
  if (admin) {
    const adminClient = createAdminSupabaseClient();
    if (!adminClient) {
      return { ok: false, message: "A roleta ainda não está configurada neste ambiente." };
    }
    const { data, error } = await adminClient.rpc("spin_roulette_as_admin", {
      p_auth_user_id: identity.authUserId,
      p_discord_user_id: identity.discordId,
    });
    return readSpinResult(data?.[0], error);
  }

  if (!chargeId || !UUID_PATTERN.test(chargeId)) {
    return { ok: false, message: "Pague R$ 1,00 para liberar o giro." };
  }

  const { data, error } = await supabase.rpc("spin_paid_roulette", {
    p_discord_user_id: identity.discordId,
    p_charge_id: chargeId,
  });
  return readSpinResult(data?.[0], error);
}

export async function logoutRoulette() {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();
  redirect("/roleta");
}

type RouletteSession = {
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>;
  identity: AdminIdentity;
};

async function readRouletteSession(): Promise<RouletteSession | { message: string }> {
  if (STORE_SLUG !== "gwstore") {
    return { message: "Esta experiência está disponível somente na GWStore." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { message: "A roleta ainda não está configurada neste ambiente." };
  }

  const { data, error } = await supabase.auth.getUser();
  const identity = data.user ? extractDiscordIdentity(data.user) : null;
  if (error || !identity) {
    return { message: "Entre novamente com o Discord para continuar." };
  }
  return { supabase, identity };
}

async function isRouletteAdmin() {
  try {
    return (await getAdminSession()).status === "authorized";
  } catch {
    return false;
  }
}

function readSpinResult(
  result:
    | { spin_id: string; prize_key: string; inventory_quantity: number }
    | undefined,
  error: { code?: string; message: string } | null,
): SpinRouletteResult {
  if (error?.code === "P0001") {
    return { ok: false, message: "Aguarde a roleta terminar antes de girar novamente." };
  }
  if (error?.code === "P0005") {
    return { ok: false, message: "Este giro já foi usado. Pague novamente para girar." };
  }
  if (error?.code === "P0006") {
    return { ok: false, message: "O pagamento ainda não foi confirmado pela LivePix." };
  }
  if (error?.code === "P0002") {
    return { ok: false, message: "Giro não encontrado. Abra um novo Pix." };
  }
  if (
    error ||
    !result ||
    !isDemoRoulettePrizeKey(result.prize_key) ||
    !Number.isSafeInteger(result.inventory_quantity) ||
    result.inventory_quantity <= 0
  ) {
    if (error) console.error(`[roleta:spin] ${error.message}`);
    return { ok: false, message: "Não foi possível concluir o giro. Tente novamente." };
  }

  return {
    ok: true,
    prizeKey: result.prize_key,
    inventoryQuantity: result.inventory_quantity,
    spinId: result.spin_id,
  };
}
