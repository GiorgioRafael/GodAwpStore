"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import {
  openRouletteRedemptionTicket,
  syncRouletteRedemptionTicketControls,
} from "@/lib/roulette/redemptions";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function settleRouletteRedemptionAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const redemptionId = text(formData, "redemptionId");
  const status = text(formData, "status");
  if (!UUID_PATTERN.test(redemptionId)) {
    return { ok: false, message: "Resgate inválido." };
  }
  if (status !== "delivered" && status !== "cancelled") {
    return { ok: false, message: "Situação inválida." };
  }

  try {
    await requireAdmin();
    const client = await createServerSupabaseClient();
    if (!client) throw new Error("Supabase não configurado.");

    const { error } = await client.rpc("admin_settle_roulette_redemption", {
      p_redemption_id: redemptionId,
      p_status: status,
    });
    if (error?.code === "P0013") {
      return { ok: false, message: "Este resgate já foi concluído." };
    }
    if (error) throw new Error(error.message);

    revalidatePath("/resgates");
    return {
      ok: true,
      message:
        status === "delivered"
          ? "Resgate marcado como entregue."
          : "Resgate cancelado e o prêmio voltou para o inventário do jogador.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:resgate:settle] ${message}`);
    return { ok: false, message: "Não foi possível atualizar o resgate agora." };
  }
}

/** Retries a ticket that never opened, without touching the redemption itself. */
export async function retryRouletteRedemptionTicketAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const redemptionId = text(formData, "redemptionId");
  if (!UUID_PATTERN.test(redemptionId)) {
    return { ok: false, message: "Resgate inválido." };
  }

  try {
    await requireAdmin();
    const ticket = await openRouletteRedemptionTicket(redemptionId);
    revalidatePath("/resgates");
    return ticket.channelId
      ? { ok: true, message: "Ticket do resgate aberto no Discord." }
      : { ok: false, message: "O ticket já está sendo criado. Aguarde alguns segundos." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:resgate:ticket] ${message}`);
    return { ok: false, message: "O Discord recusou abrir o ticket agora." };
  }
}

/** Re-posts the ticket buttons on a redemption whose ticket is already open. */
export async function syncRouletteRedemptionControlsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const redemptionId = text(formData, "redemptionId");
  if (!UUID_PATTERN.test(redemptionId)) {
    return { ok: false, message: "Resgate inválido." };
  }

  try {
    await requireAdmin();
    const result = await syncRouletteRedemptionTicketControls(redemptionId);
    revalidatePath("/resgates");
    return result.synchronized
      ? { ok: true, message: "Botões do ticket atualizados no Discord." }
      : { ok: false, message: "Este resgate ainda não tem um ticket aberto." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:resgate:controles] ${message}`);
    return { ok: false, message: "O Discord recusou atualizar os botões agora." };
  }
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
