"use server";

import { commissionBpsSchema, uuidSchema } from "@godawp/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireMasterAdmin } from "@/lib/master-auth-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type DiscordBotsActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

const adminPanelUrlSchema = z
  .string()
  .trim()
  .max(2_048, "O link é longo demais.")
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Informe um link HTTPS válido.");

function parseCommissionBps(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const percentage = Number(normalized);
  if (!Number.isFinite(percentage)) return null;
  return Math.round(percentage * 100);
}

async function actionClient() {
  const identity = await requireMasterAdmin();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Supabase não configurado.");
  return { identity, supabase };
}

export async function saveMasterCommissionAction(
  _previousState: DiscordBotsActionState,
  formData: FormData,
): Promise<DiscordBotsActionState> {
  const commissionBps = parseCommissionBps(formData.get("commissionPercent"));
  const parsed = commissionBpsSchema.safeParse(commissionBps);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise o percentual de comissão.",
      fieldErrors: { commissionPercent: ["Use um valor entre 0,00% e 100,00%."] },
    };
  }

  const { identity, supabase } = await actionClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .update({
      global_commission_bps: parsed.data,
      updated_by: identity.authUserId,
      display_timezone: "America/Sao_Paulo",
    })
    .eq("id", 1)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: "Não foi possível salvar a comissão." };
  if (!data) return { ok: false, message: "A configuração da plataforma não foi encontrada." };

  revalidatePath("/admin/discordbots");
  revalidatePath("/configuracoes");
  revalidatePath("/whitelist");
  return { ok: true, message: "Comissão padrão atualizada." };
}

export async function saveBusinessAdminUrlAction(
  _previousState: DiscordBotsActionState,
  formData: FormData,
): Promise<DiscordBotsActionState> {
  const companyId = uuidSchema.safeParse(formData.get("companyId"));
  const adminPanelUrl = adminPanelUrlSchema.safeParse(formData.get("adminPanelUrl"));
  if (!companyId.success || !adminPanelUrl.success) {
    return {
      ok: false,
      message: "Revise o link do painel individual.",
      fieldErrors: {
        adminPanelUrl: [
          adminPanelUrl.success ? "Empresa inválida." : adminPanelUrl.error.issues[0]?.message ?? "Link inválido.",
        ],
      },
    };
  }

  const { supabase } = await actionClient();
  const { data, error } = await supabase
    .from("whitelist_entries")
    .update({ admin_panel_url: adminPanelUrl.data || null })
    .eq("id", companyId.data)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: "Não foi possível salvar o link." };
  if (!data) return { ok: false, message: "A empresa não foi encontrada." };

  revalidatePath("/admin/discordbots");
  return { ok: true, message: "Link do painel atualizado." };
}
