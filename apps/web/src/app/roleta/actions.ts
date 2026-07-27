"use server";

import { redirect } from "next/navigation";

import { extractDiscordIdentity, type AdminIdentity } from "@/lib/auth-identity";
import { getAdminSession } from "@/lib/auth";
import { STORE_SLUG } from "@/lib/brand";
import { getSiteUrl } from "@/lib/env";
import type { RouletteCoinPurchaseStatus } from "@/lib/roulette/coin-purchase";
import {
  isDemoRoulettePrizeKey,
  MAXIMUM_COIN_PURCHASE,
  MINIMUM_COIN_PURCHASE,
  type DemoRoulettePrizeKey,
} from "@/lib/roulette/demo";
import { openRouletteRedemptionTicket } from "@/lib/roulette/redemptions";
import { getRouletteCoinPurchaseService } from "@/lib/roulette/runtime";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SpinRouletteResult =
  | {
      ok: true;
      prizeKey: DemoRoulettePrizeKey;
      inventoryQuantity: number;
      balanceCents: number;
      spinId: string;
    }
  | { ok: false; message: string };

export type SellRoulettePrizeResult =
  | {
      ok: true;
      prizeKey: DemoRoulettePrizeKey;
      remainingQuantity: number;
      creditedCents: number;
      balanceCents: number;
    }
  | { ok: false; message: string };

export type RedeemRoulettePrizeResult =
  | {
      ok: true;
      prizeKey: DemoRoulettePrizeKey;
      productName: string;
      remainingQuantity: number;
      ticketOpened: boolean;
    }
  | { ok: false; message: string };

export type RouletteCoinPurchaseResult =
  | {
      ok: true;
      purchaseId: string;
      status: RouletteCoinPurchaseStatus;
      checkoutUrl: string | null;
      amountCents: number;
    }
  | { ok: false; message: string };

export type RouletteCoinPurchaseStatusResult =
  | {
      ok: true;
      purchaseId: string;
      status: RouletteCoinPurchaseStatus;
      balanceCents: number;
    }
  | { ok: false; message: string };

/**
 * Opens (or reuses) the LivePix charge that buys `coinQuantity` coins at
 * R$ 1,00 each.
 */
export async function startRouletteCoinPurchase(
  coinQuantity: number,
): Promise<RouletteCoinPurchaseResult> {
  if (
    !Number.isSafeInteger(coinQuantity) ||
    coinQuantity < MINIMUM_COIN_PURCHASE ||
    coinQuantity > MAXIMUM_COIN_PURCHASE
  ) {
    return {
      ok: false,
      message: `Escolha de ${MINIMUM_COIN_PURCHASE} a ${MAXIMUM_COIN_PURCHASE} moedas.`,
    };
  }

  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };
  const { supabase, identity } = session;

  const { data, error } = await supabase.rpc("start_roulette_coin_purchase", {
    p_discord_user_id: identity.discordId,
    p_coin_quantity: coinQuantity,
  });
  const purchase = data?.[0];
  if (error || !purchase) {
    console.error(`[roleta:compra] ${error?.message ?? "cobrança não criada"}`);
    return { ok: false, message: "Não foi possível abrir o Pix das moedas. Tente novamente." };
  }
  if (purchase.purchase_status !== "awaiting_payment") {
    return { ok: false, message: "Esta compra não está mais disponível. Recarregue a página." };
  }

  try {
    const checkout = await getRouletteCoinPurchaseService().createCheckout(
      purchase.purchase_id,
      getSiteUrl(),
    );
    return {
      ok: true,
      purchaseId: purchase.purchase_id,
      status: "awaiting_payment",
      checkoutUrl: checkout.checkoutUrl,
      amountCents: purchase.purchase_amount_cents,
    };
  } catch (error) {
    console.error(
      `[roleta:checkout] ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    return { ok: false, message: "O Pix das moedas não pôde ser gerado agora. Tente novamente." };
  }
}

/**
 * Reports whether the coins already landed. The LivePix webhook is the primary
 * confirmation; this also pulls the provider directly, rate limited in the
 * database, so a delayed webhook never strands a paid purchase.
 */
export async function getRouletteCoinPurchaseStatus(
  purchaseId: string,
): Promise<RouletteCoinPurchaseStatusResult> {
  if (!UUID_PATTERN.test(purchaseId)) {
    return { ok: false, message: "Compra inválida." };
  }
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };
  const { supabase } = session;

  const { data, error } = await supabase.rpc("get_roulette_coin_purchase", {
    p_purchase_id: purchaseId,
  });
  const purchase = data?.[0];
  if (error || !purchase) {
    return { ok: false, message: "Compra não encontrada. Abra um novo Pix." };
  }
  if (purchase.purchase_status !== "awaiting_payment") {
    return {
      ok: true,
      purchaseId: purchase.purchase_id,
      status: purchase.purchase_status,
      balanceCents: await readCoinBalance(supabase),
    };
  }

  try {
    const credit = await getRouletteCoinPurchaseService().pullPendingPayment(purchaseId);
    if (credit) {
      return {
        ok: true,
        purchaseId: credit.purchaseId,
        status: credit.status,
        balanceCents: credit.coinBalanceCents,
      };
    }
  } catch (error) {
    // The webhook still owns the authoritative confirmation; a failed pull only
    // means this poll learned nothing new.
    console.error(`[roleta:pull] ${error instanceof Error ? error.message : "erro desconhecido"}`);
  }

  return {
    ok: true,
    purchaseId: purchase.purchase_id,
    status: "awaiting_payment",
    balanceCents: await readCoinBalance(supabase),
  };
}

/**
 * Spins the wheel. Regular players spend one coin; administrators listed in
 * ADMIN_DISCORD_IDS spin for free for internal testing.
 */
export async function spinRoulette(): Promise<SpinRouletteResult> {
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };
  const { supabase, identity } = session;

  if (await isRouletteAdmin()) {
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

  const { data, error } = await supabase.rpc("spin_roulette", {
    p_discord_user_id: identity.discordId,
  });
  return readSpinResult(data?.[0], error);
}

/** Sells one unit of an inventory prize back for coins. */
export async function sellRoulettePrize(
  prizeKey: string,
): Promise<SellRoulettePrizeResult> {
  if (!isDemoRoulettePrizeKey(prizeKey)) {
    return { ok: false, message: "Prêmio inválido." };
  }
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };

  const { data, error } = await session.supabase.rpc("sell_roulette_prize", {
    p_prize_key: prizeKey,
  });
  const sale = data?.[0];
  if (error?.code === "P0008") {
    return { ok: false, message: "Você não tem mais esse item no inventário." };
  }
  if (error?.code === "P0010" || error?.code === "P0011") {
    return { ok: false, message: "Este item não tem valor de recompra no momento." };
  }
  if (error || !sale || !isDemoRoulettePrizeKey(sale.sold_prize_key)) {
    if (error) console.error(`[roleta:venda] ${error.code ?? "sem código"} ${error.message}`);
    return { ok: false, message: "Não foi possível vender o item. Tente novamente." };
  }

  return {
    ok: true,
    prizeKey: sale.sold_prize_key,
    remainingQuantity: safeCount(sale.remaining_quantity),
    creditedCents: safeCount(sale.credited_amount_cents),
    balanceCents: safeCount(sale.coin_balance_cents),
  };
}

/**
 * Takes one prize out of the inventory for hand delivery: it lands in the admin
 * panel and opens a private Discord ticket for the player.
 */
export async function redeemRoulettePrize(
  prizeKey: string,
): Promise<RedeemRoulettePrizeResult> {
  if (!isDemoRoulettePrizeKey(prizeKey)) {
    return { ok: false, message: "Prêmio inválido." };
  }
  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };

  const { data, error } = await session.supabase.rpc("redeem_roulette_prize", {
    p_prize_key: prizeKey,
  });
  const redemption = data?.[0];
  if (error?.code === "P0008") {
    return { ok: false, message: "Você não tem mais esse item no inventário." };
  }
  if (error?.code === "P0010") {
    return { ok: false, message: "Este item saiu do catálogo e não pode ser resgatado." };
  }
  if (error?.code === "P0012") {
    return { ok: false, message: "O servidor de entrega está indisponível. Fale com a equipe." };
  }
  if (error || !redemption || !isDemoRoulettePrizeKey(redemption.redeemed_prize_key)) {
    if (error) console.error(`[roleta:resgate] ${error.code ?? "sem código"} ${error.message}`);
    return { ok: false, message: "Não foi possível abrir o resgate. Tente novamente." };
  }

  // The prize already left the inventory, so a Discord failure must not undo
  // the request: the reconciliation cron retries the ticket.
  let ticketOpened = false;
  try {
    const ticket = await openRouletteRedemptionTicket(redemption.redemption_id);
    ticketOpened = Boolean(ticket.channelId);
  } catch (error) {
    console.error(
      `[roleta:resgate:ticket] ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
  }

  return {
    ok: true,
    prizeKey: redemption.redeemed_prize_key,
    productName: redemption.redeemed_product_name,
    remainingQuantity: safeCount(redemption.remaining_quantity),
    ticketOpened,
  };
}

export async function logoutRoulette() {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();
  redirect("/roleta");
}

type SessionClient = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>;

type RouletteSession = {
  supabase: SessionClient;
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

async function readCoinBalance(supabase: SessionClient) {
  const { data } = await supabase.rpc("get_roulette_coin_balance");
  return safeCount(data);
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
    | {
        recorded_spin_id: string;
        won_prize_key: string;
        won_inventory_quantity: number;
        coin_balance_cents: number;
      }
    | undefined,
  error: { code?: string; message: string } | null,
): SpinRouletteResult {
  if (error?.code === "P0001") {
    return { ok: false, message: "Aguarde a roleta terminar antes de girar novamente." };
  }
  if (error?.code === "P0007") {
    return { ok: false, message: "Moedas insuficientes. Compre moedas ou venda um item." };
  }
  if (error?.code === "P0009") {
    return { ok: false, message: "A roleta está sem prêmios configurados." };
  }
  if (
    error ||
    !result ||
    !isDemoRoulettePrizeKey(result.won_prize_key) ||
    !Number.isSafeInteger(result.won_inventory_quantity) ||
    result.won_inventory_quantity <= 0
  ) {
    if (error) console.error(`[roleta:spin] ${error.code ?? "sem código"} ${error.message}`);
    return { ok: false, message: "Não foi possível concluir o giro. Tente novamente." };
  }

  return {
    ok: true,
    prizeKey: result.won_prize_key,
    inventoryQuantity: result.won_inventory_quantity,
    balanceCents: safeCount(result.coin_balance_cents),
    spinId: result.recorded_spin_id,
  };
}

function safeCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
