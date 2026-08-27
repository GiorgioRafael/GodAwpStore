"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { MAXIMUM_WHEEL_SLOTS } from "@/lib/roulette/demo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Tem que andar junto da constraint roulette_prize_products_quantity_sane.
const MAXIMUM_PRIZE_QUANTITY = 10_000;
const MAXIMUM_WEIGHT = 1_000_000;
const PRIZE_KEY_PATTERN = /^premio_([1-9][0-9]?)$/;

/**
 * Saves the whole wheel at once. The odds are relative — moving one weight
 * moves every other slot's chance — so a partial save would leave a wheel
 * nobody chose.
 */
export async function saveRouletteWheelAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const slots: Array<{
    prize_key: string;
    product_id: string;
    draw_weight: number;
    prize_quantity: number;
  }> = [];

  // The wheel is whatever the form carries, so adding a slice needs no code
  // change here — a fixed key list would silently drop the sixth one.
  const prizeKeys = [...formData.keys()]
    .filter((name) => name.startsWith("product-"))
    .map((name) => name.slice("product-".length))
    .filter((key, index, all) => all.indexOf(key) === index);

  for (const prizeKey of prizeKeys) {
    if (!PRIZE_KEY_PATTERN.test(prizeKey)) {
      return { ok: false, message: `A fatia ${prizeKey} não existe na roda.` };
    }
    const slotNumber = Number(PRIZE_KEY_PATTERN.exec(prizeKey)![1]);
    if (slotNumber > MAXIMUM_WHEEL_SLOTS) {
      return { ok: false, message: `A roda vai até ${MAXIMUM_WHEEL_SLOTS} fatias.` };
    }
    const productId = text(formData, `product-${prizeKey}`);
    const weight = Number(text(formData, `weight-${prizeKey}`).replace(",", "."));
    const quantity = Number(text(formData, `quantity-${prizeKey}`).replace(",", "."));
    if (!productId) continue;

    if (!UUID_PATTERN.test(productId)) {
      return { ok: false, message: `O produto da fatia ${prizeKey} é inválido.` };
    }
    if (!Number.isFinite(weight) || weight < 1 || weight > MAXIMUM_WEIGHT) {
      return {
        ok: false,
        message: `O peso da fatia ${prizeKey} tem que ficar entre 1 e ${MAXIMUM_WEIGHT}.`,
      };
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAXIMUM_PRIZE_QUANTITY) {
      return {
        ok: false,
        message: `A quantidade da fatia ${prizeKey} tem que ficar entre 1 e ${MAXIMUM_PRIZE_QUANTITY}.`,
      };
    }
    slots.push({
      prize_key: prizeKey,
      product_id: productId,
      draw_weight: Math.round(weight),
      prize_quantity: Math.round(quantity),
    });
  }

  if (!slots.length) {
    return { ok: false, message: "A roda precisa de ao menos um prêmio." };
  }
  if (slots.length > MAXIMUM_WHEEL_SLOTS) {
    return { ok: false, message: `A roda vai até ${MAXIMUM_WHEEL_SLOTS} fatias.` };
  }

  try {
    await requireAdmin();
    const client = await createServerSupabaseClient();
    if (!client) throw new Error("Supabase não configurado.");

    const { data, error } = await client.rpc("admin_save_roulette_wheel", { p_slots: slots });
    if (error?.code === "23503") {
      return { ok: false, message: "Um dos produtos escolhidos foi arquivado ou removido." };
    }
    if (error) throw new Error(error.message);

    const saved = data?.[0];
    revalidatePath("/metricas-roleta");
    revalidatePath("/roleta");
    return {
      ok: true,
      message: saved
        ? `Roda salva: ${saved.saved_slot_count} prêmio(s), devolvendo ${(saved.saved_return_bps / 100).toFixed(1)}% por giro.`
        : "Roda salva.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:roleta:roda] ${message}`);
    return { ok: false, message: "Não foi possível salvar a roda agora." };
  }
}

/** Pauses or resumes the wheel without touching a single balance or prize. */
export async function toggleRouletteAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const enabled = formData.get("enabled") === "on";

  try {
    await requireAdmin();
    const client = await createServerSupabaseClient();
    if (!client) throw new Error("Supabase não configurado.");

    const { data, error } = await client
      .from("platform_settings")
      .update({ roulette_enabled: enabled })
      .eq("id", 1)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ok: false, message: "Configurações globais não encontradas." };

    revalidatePath("/metricas-roleta");
    revalidatePath("/roleta");
    return {
      ok: true,
      message: enabled
        ? "Roleta liberada. Os jogadores já podem girar."
        : "Roleta pausada. Ninguém gira; saldos, inventários e resgates continuam intactos.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:roleta:pausa] ${message}`);
    return { ok: false, message: "Não foi possível mudar o estado da roleta agora." };
  }
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}
