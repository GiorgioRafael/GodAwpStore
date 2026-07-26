"use server";

import { redirect } from "next/navigation";

import { extractDiscordIdentity } from "@/lib/auth-identity";
import { STORE_SLUG } from "@/lib/brand";
import {
  isDemoRoulettePrizeKey,
  type DemoRoulettePrizeKey,
} from "@/lib/roulette/demo";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SpinDemoRouletteResult =
  | {
      ok: true;
      prizeKey: DemoRoulettePrizeKey;
      inventoryQuantity: number;
      spinId: string;
    }
  | { ok: false; message: string };

export async function spinDemoRoulette(): Promise<SpinDemoRouletteResult> {
  if (STORE_SLUG !== "gwstore") {
    return { ok: false, message: "Esta experiência está disponível somente na GWStore." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "A roleta ainda não está configurada neste ambiente." };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const identity = authData.user ? extractDiscordIdentity(authData.user) : null;
  if (authError || !identity) {
    return { ok: false, message: "Entre novamente com o Discord para continuar." };
  }

  const { data, error } = await supabase.rpc("spin_demo_roulette", {
    p_discord_user_id: identity.discordId,
  });
  const result = data?.[0];
  if (error?.code === "P0001") {
    return { ok: false, message: "Aguarde a roleta terminar antes de girar novamente." };
  }
  if (
    error ||
    !result ||
    !isDemoRoulettePrizeKey(result.prize_key) ||
    !Number.isSafeInteger(result.inventory_quantity) ||
    result.inventory_quantity <= 0
  ) {
    return { ok: false, message: "Não foi possível concluir o giro. Tente novamente." };
  }

  return {
    ok: true,
    prizeKey: result.prize_key,
    inventoryQuantity: result.inventory_quantity,
    spinId: result.spin_id,
  };
}

export async function logoutRoulette() {
  const supabase = await createServerSupabaseClient();
  await supabase?.auth.signOut();
  redirect("/roleta");
}
