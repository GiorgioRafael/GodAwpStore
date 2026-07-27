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

/** One inventory line the player selected, with how many units to act on. */
export type RouletteSelection = {
  prizeKey: DemoRoulettePrizeKey;
  quantity: number;
};

export type RouletteSettledLine = {
  prizeKey: DemoRoulettePrizeKey;
  remainingQuantity: number;
};

export type SellRoulettePrizeResult =
  | {
      ok: true;
      lines: RouletteSettledLine[];
      itemCount: number;
      creditedCents: number;
      balanceCents: number;
    }
  | { ok: false; message: string };

export type RedeemRoulettePrizeResult =
  | {
      ok: true;
      lines: RouletteSettledLine[];
      itemCount: number;
      productNames: string[];
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
      p_display_name: identity.displayName,
    });
    return readSpinResult(data?.[0], error);
  }

  const { data, error } = await supabase.rpc("spin_roulette", {
    p_discord_user_id: identity.discordId,
    p_display_name: identity.displayName,
  });
  return readSpinResult(data?.[0], error);
}

/** Sells the selected inventory prizes back for coins in one transaction. */
export async function sellRoulettePrizes(
  selection: RouletteSelection[],
): Promise<SellRoulettePrizeResult> {
  const items = normalizeSelection(selection);
  if (!items) return { ok: false, message: "Escolha ao menos um item válido." };

  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };

  const { data, error } = await session.supabase.rpc("sell_roulette_prizes", {
    p_items: items,
  });
  const sale = data?.[0];
  if (error?.code === "P0008") {
    return { ok: false, message: "Você não tem essa quantidade no inventário." };
  }
  if (error?.code === "P0010" || error?.code === "P0011") {
    return { ok: false, message: "Um dos itens não tem valor de recompra no momento." };
  }
  if (error || !sale) {
    if (error) console.error(`[roleta:venda] ${error.code ?? "sem código"} ${error.message}`);
    return { ok: false, message: "Não foi possível vender os itens. Tente novamente." };
  }

  return {
    ok: true,
    lines: readSettledLines(sale.sold_items),
    itemCount: safeCount(sale.sold_item_count),
    creditedCents: safeCount(sale.sold_total_credited_cents),
    balanceCents: safeCount(sale.coin_balance_cents),
  };
}

/**
 * Takes the selected prizes out of the inventory for hand delivery: they land
 * in the admin panel as one request and open one private Discord ticket.
 */
export async function redeemRoulettePrizes(
  selection: RouletteSelection[],
): Promise<RedeemRoulettePrizeResult> {
  const items = normalizeSelection(selection);
  if (!items) return { ok: false, message: "Escolha ao menos um item válido." };

  const session = await readRouletteSession();
  if ("message" in session) return { ok: false, message: session.message };

  const { data, error } = await session.supabase.rpc("redeem_roulette_prizes", {
    p_items: items,
  });
  const redemption = data?.[0];
  if (error?.code === "P0008") {
    return { ok: false, message: "Você não tem essa quantidade no inventário." };
  }
  if (error?.code === "P0010") {
    return { ok: false, message: "Um dos itens saiu do catálogo e não pode ser resgatado." };
  }
  if (error?.code === "P0012") {
    return { ok: false, message: "O servidor de entrega está indisponível. Fale com a equipe." };
  }
  if (error?.code === "P0016") {
    return {
      ok: false,
      message:
        "Um dos itens está sem estoque agora. Você pode vender de volta ou tentar o resgate mais tarde.",
    };
  }
  if (error || !redemption) {
    if (error) console.error(`[roleta:resgate] ${error.code ?? "sem código"} ${error.message}`);
    return { ok: false, message: "Não foi possível abrir o resgate. Tente novamente." };
  }

  // The prizes already left the inventory, so a Discord failure must not undo
  // the request: the reconciliation cron retries the ticket.
  let ticketOpened = false;
  try {
    const ticket = await openRouletteRedemptionTicket(redemption.created_redemption_id);
    ticketOpened = Boolean(ticket.channelId);
  } catch (error) {
    console.error(
      `[roleta:resgate:ticket] ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
  }

  return {
    ok: true,
    lines: readSettledLines(redemption.redeemed_items),
    itemCount: safeCount(redemption.redeemed_item_count),
    productNames: readProductNames(redemption.redeemed_items),
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

/** Validates the browser selection before it reaches the database. */
function normalizeSelection(selection: RouletteSelection[]) {
  if (!Array.isArray(selection) || selection.length < 1 || selection.length > 5) return null;
  const seen = new Set<string>();
  const items: Array<{ prize_key: string; quantity: number }> = [];
  for (const line of selection) {
    if (!isDemoRoulettePrizeKey(line?.prizeKey)) return null;
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10_000) {
      return null;
    }
    if (seen.has(line.prizeKey)) return null;
    seen.add(line.prizeKey);
    items.push({ prize_key: line.prizeKey, quantity: line.quantity });
  }
  return items;
}

function readSettledLines(value: unknown): RouletteSettledLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const line = entry as { prize_key?: unknown; remaining_quantity?: unknown };
    return isDemoRoulettePrizeKey(line.prize_key) &&
      Number.isSafeInteger(line.remaining_quantity)
      ? [{ prizeKey: line.prize_key, remainingQuantity: Number(line.remaining_quantity) }]
      : [];
  });
}

function readProductNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const line = entry as { product_name?: unknown; quantity?: unknown };
    return typeof line.product_name === "string" && line.product_name.trim()
      ? [`${Number(line.quantity) || 1}x ${line.product_name.trim()}`]
      : [];
  });
}

function safeCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
