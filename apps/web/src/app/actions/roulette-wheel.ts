"use server";

import { revalidatePath } from "next/cache";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIZE_KEYS = ["premio_1", "premio_2", "premio_3", "premio_4", "premio_5"];
const MAXIMUM_WEIGHT = 1_000_000;

/**
 * Saves the whole wheel at once. The odds are relative — moving one weight
 * moves every other slot's chance — so a partial save would leave a wheel
 * nobody chose.
 */
export async function saveRouletteWheelAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const slots: Array<{ prize_key: string; product_id: string; draw_weight: number }> = [];

  for (const prizeKey of PRIZE_KEYS) {
    const productId = text(formData, `product-${prizeKey}`);
    const weight = Number(text(formData, `weight-${prizeKey}`).replace(",", "."));
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
    slots.push({ prize_key: prizeKey, product_id: productId, draw_weight: Math.round(weight) });
  }

  if (!slots.length) {
    return { ok: false, message: "A roda precisa de ao menos um prêmio." };
  }

  try {
    await requireAdmin();
    const client = await createServerSupabaseClient();
    if (!client) throw new Error("Supabase não configurado.");

    const { data, error } = await client.rpc("admin_save_roulette_wheel", { p_slots: slots });
    if (error?.code === "P0014") {
      return {
        ok: false,
        message:
          "Uma das fatias tem prêmio na mão de algum jogador e não pode trocar de produto. Espere a entrega ou o resgate antes de mexer nela.",
      };
    }
    if (error?.code === "23503") {
      return { ok: false, message: "Um dos produtos escolhidos não está mais à venda." };
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
