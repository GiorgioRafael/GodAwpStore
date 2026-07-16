"use server";

import {
  gameInputSchema,
  parseBrlToCents,
  platformSettingsSchema,
  productInputSchema,
  substoreInputSchema,
  uuidSchema,
  whitelistEntryInputSchema,
} from "@godawp/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { BotCommerceService } from "@/lib/bot/commerce-service";
import {
  listDiscordTextChannels,
  publishDiscordStorefront,
  readStorefrontConfiguration,
  withStorefrontConfiguration,
} from "@/lib/bot/discord-storefront";
import { SupabaseBotCommerceRepository } from "@/lib/bot/supabase-repository";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AdminActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

const archiveTargetSchema = z.enum(["game", "substore", "product", "whitelist"]);
const inventoryStatusChangeSchema = z.object({
  unitId: uuidSchema,
  status: z.enum(["available", "quarantined", "revoked"]),
  reason: z.string().trim().max(1_000).nullable(),
});
const discordStorefrontSchema = z.object({
  guildId: uuidSchema,
  channelId: z.string().regex(/^[0-9]{15,22}$/, "Canal Discord inválido."),
});

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, name: string): string | null {
  const value = text(formData, name);
  return value || null;
}

function integer(formData: FormData, name: string, fallback = 0): number {
  const value = text(formData, name);
  return value === "" ? fallback : Number(value);
}

function percentageToBps(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const percentage = Number(normalized);
  if (!Number.isFinite(percentage)) return Number.NaN;
  return Math.round(percentage * 100);
}

function errorsFromZod(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}

function databaseFailure(code?: string): AdminActionState {
  if (code === "23505") {
    return { ok: false, message: "Já existe um registro com esse identificador ou slug." };
  }
  if (code === "23503") {
    return { ok: false, message: "O registro relacionado não existe ou foi arquivado." };
  }
  return { ok: false, message: "Não foi possível salvar. Tente novamente." };
}

async function actionContext() {
  const identity = await requireAdmin();
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Supabase não configurado.");
  return { identity, supabase };
}

export async function saveGameAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = gameInputSchema.safeParse({
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    description: nullableText(formData, "description"),
    imageUrl: nullableText(formData, "imageUrl"),
    status: text(formData, "status") || "active",
    sortOrder: integer(formData, "sortOrder"),
  });
  const parsedId = text(formData, "id") ? uuidSchema.safeParse(text(formData, "id")) : null;

  if (!parsed.success || (parsedId && !parsedId.success)) {
    return {
      ok: false,
      message: "Revise os campos do jogo.",
      fieldErrors: parsed.success ? { id: ["ID inválido."] } : errorsFromZod(parsed.error),
    };
  }

  const { identity, supabase } = await actionContext();
  const record = {
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description,
    image_url: parsed.data.imageUrl,
    status: parsed.data.status,
    sort_order: parsed.data.sortOrder,
    archived_at: parsed.data.status === "archived" ? new Date().toISOString() : null,
  };
  const id = parsedId?.success ? parsedId.data : null;
  const operation = id
    ? supabase.from("games").update(record).eq("id", id).select("id").maybeSingle()
    : supabase
        .from("games")
        .insert({ ...record, created_by: identity.authUserId })
        .select("id")
        .single();
  const { data, error } = await operation;
  if (error) return databaseFailure(error.code);
  if (!data) return { ok: false, message: "Jogo não encontrado." };
  revalidatePath("/catalogo/jogos");
  revalidatePath("/dashboard");
  return { ok: true, message: id ? "Jogo atualizado." : "Jogo criado." };
}

export async function saveSubstoreAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = substoreInputSchema.safeParse({
    gameId: text(formData, "gameId"),
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    title: text(formData, "title"),
    description: text(formData, "description"),
    color: text(formData, "color") || "#D4AF37",
    imageUrl: nullableText(formData, "imageUrl"),
    thumbnailUrl: nullableText(formData, "thumbnailUrl"),
    authorName: nullableText(formData, "authorName"),
    authorIconUrl: nullableText(formData, "authorIconUrl"),
    footerText: nullableText(formData, "footerText"),
    footerIconUrl: nullableText(formData, "footerIconUrl"),
    status: text(formData, "status") || "active",
    sortOrder: integer(formData, "sortOrder"),
  });
  const parsedId = text(formData, "id") ? uuidSchema.safeParse(text(formData, "id")) : null;

  if (!parsed.success || (parsedId && !parsedId.success)) {
    return {
      ok: false,
      message: "Revise os campos da subloja.",
      fieldErrors: parsed.success ? { id: ["ID inválido."] } : errorsFromZod(parsed.error),
    };
  }

  const { identity, supabase } = await actionContext();
  const record = {
    game_id: parsed.data.gameId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    title: parsed.data.title,
    description: parsed.data.description,
    color_hex: parsed.data.color,
    image_url: parsed.data.imageUrl,
    thumbnail_url: parsed.data.thumbnailUrl,
    author_name: parsed.data.authorName,
    author_icon_url: parsed.data.authorIconUrl,
    footer_text: parsed.data.footerText,
    footer_icon_url: parsed.data.footerIconUrl,
    status: parsed.data.status,
    sort_order: parsed.data.sortOrder,
    archived_at: parsed.data.status === "archived" ? new Date().toISOString() : null,
  };
  const id = parsedId?.success ? parsedId.data : null;
  const operation = id
    ? supabase.from("substores").update(record).eq("id", id).select("id").maybeSingle()
    : supabase
        .from("substores")
        .insert({ ...record, created_by: identity.authUserId })
        .select("id")
        .single();
  const { data, error } = await operation;
  if (error) return databaseFailure(error.code);
  if (!data) return { ok: false, message: "Subloja não encontrada." };
  revalidatePath("/catalogo/sublojas");
  revalidatePath("/dashboard");
  return { ok: true, message: id ? "Subloja atualizada." : "Subloja criada." };
}

export async function saveProductAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let minimumPriceCents = Number.NaN;
  try {
    minimumPriceCents = parseBrlToCents(text(formData, "minimumPrice"));
  } catch {
    // Zod reports the normalized field below.
  }

  const parsed = productInputSchema.safeParse({
    substoreId: text(formData, "substoreId"),
    name: text(formData, "name"),
    slug: text(formData, "slug"),
    description: nullableText(formData, "description"),
    minimumPriceCents,
    imageUrl: nullableText(formData, "imageUrl"),
    status: text(formData, "status") || "active",
    sortOrder: integer(formData, "sortOrder"),
    lowStockThreshold: integer(formData, "lowStockThreshold", 5),
  });
  const parsedId = text(formData, "id") ? uuidSchema.safeParse(text(formData, "id")) : null;

  if (!parsed.success || (parsedId && !parsedId.success)) {
    const fieldErrors = parsed.success ? { id: ["ID inválido."] } : errorsFromZod(parsed.error);
    if (!Number.isFinite(minimumPriceCents)) fieldErrors.minimumPrice = ["Informe um valor como 10,00."];
    return { ok: false, message: "Revise os campos do produto.", fieldErrors };
  }

  const { identity, supabase } = await actionContext();
  const record = {
    substore_id: parsed.data.substoreId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description,
    minimum_price_cents: parsed.data.minimumPriceCents,
    image_url: parsed.data.imageUrl,
    status: parsed.data.status,
    sort_order: parsed.data.sortOrder,
    low_stock_threshold: parsed.data.lowStockThreshold,
    archived_at: parsed.data.status === "archived" ? new Date().toISOString() : null,
  };
  const id = parsedId?.success ? parsedId.data : null;
  const operation = id
    ? supabase.from("products").update(record).eq("id", id).select("id").maybeSingle()
    : supabase
        .from("products")
        .insert({ ...record, created_by: identity.authUserId })
        .select("id")
        .single();
  const { data, error } = await operation;
  if (error) return databaseFailure(error.code);
  if (!data) return { ok: false, message: "Produto não encontrado." };
  revalidatePath("/catalogo/produtos");
  revalidatePath("/estoque");
  revalidatePath("/dashboard");
  return { ok: true, message: id ? "Produto atualizado." : "Produto criado." };
}

export async function saveWhitelistAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const overrideText = text(formData, "commissionOverridePercent");
  const parsed = whitelistEntryInputSchema.safeParse({
    discordId: text(formData, "discordId"),
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: nullableText(formData, "notes"),
    commissionOverrideBps: overrideText ? percentageToBps(overrideText) : null,
  });
  const label = nullableText(formData, "label");
  const parsedId = text(formData, "id") ? uuidSchema.safeParse(text(formData, "id")) : null;

  if (!parsed.success || (parsedId && !parsedId.success) || (label && label.length > 120)) {
    return {
      ok: false,
      message: "Revise os campos da whitelist.",
      fieldErrors: parsed.success ? { form: ["ID ou identificação inválida."] } : errorsFromZod(parsed.error),
    };
  }

  const { identity, supabase } = await actionContext();
  const record = {
    discord_id: parsed.data.discordId,
    label,
    notes: parsed.data.notes,
    is_active: parsed.data.active,
    commission_override_bps: parsed.data.commissionOverrideBps,
  };
  const id = parsedId?.success ? parsedId.data : null;
  const operation = id
    ? supabase.from("whitelist_entries").update(record).eq("id", id).select("id").maybeSingle()
    : supabase
        .from("whitelist_entries")
        .insert({ ...record, created_by: identity.authUserId })
        .select("id")
        .single();
  const { data, error } = await operation;
  if (error) return databaseFailure(error.code);
  if (!data) return { ok: false, message: "Entrada da whitelist não encontrada." };
  revalidatePath("/whitelist");
  revalidatePath("/dashboard");
  return { ok: true, message: id ? "Whitelist atualizada." : "Discord ID autorizado." };
}

export async function savePlatformSettingsAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = platformSettingsSchema.safeParse({
    currency: "BRL",
    globalCommissionBps: percentageToBps(text(formData, "globalCommissionPercent")),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Informe uma comissão entre 0 e 100%.",
      fieldErrors: errorsFromZod(parsed.error),
    };
  }

  const { identity, supabase } = await actionContext();
  const { error } = await supabase.from("platform_settings").upsert({
    id: 1,
    currency_code: "BRL",
    global_commission_bps: parsed.data.globalCommissionBps,
    display_timezone: "America/Sao_Paulo",
    updated_by: identity.authUserId,
  });
  if (error) return databaseFailure(error.code);

  revalidatePath("/configuracoes");
  revalidatePath("/whitelist");
  return { ok: true, message: "Configurações atualizadas." };
}

export async function publishDiscordStorefrontAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = discordStorefrontSchema.safeParse({
    guildId: text(formData, "guildId"),
    channelId: text(formData, "channelId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Selecione um servidor e um canal de texto válidos.",
      fieldErrors: errorsFromZod(parsed.error),
    };
  }

  try {
    const { supabase } = await actionContext();
    const { data: guild, error: guildError } = await supabase
      .from("guilds")
      .select("id,discord_guild_id,name,configuration")
      .eq("id", parsed.data.guildId)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    if (guildError) return databaseFailure(guildError.code);
    if (!guild) return { ok: false, message: "Servidor Discord ativo não encontrado." };

    const channels = await listDiscordTextChannels(guild.discord_guild_id);
    const channel = channels.find((item) => item.id === parsed.data.channelId);
    if (!channel) {
      return {
        ok: false,
        message: "O canal selecionado não pertence ao servidor ou o bot não consegue acessá-lo.",
        fieldErrors: { channelId: ["Selecione outro canal de texto."] },
      };
    }

    const catalog = await new BotCommerceService(
      new SupabaseBotCommerceRepository(),
    ).listCatalog();
    const published = await publishDiscordStorefront({
      channel,
      catalog,
      previous: readStorefrontConfiguration(guild.configuration),
    });

    const { error: updateError } = await supabase
      .from("guilds")
      .update({
        configuration: withStorefrontConfiguration(
          guild.configuration,
          published.configuration,
        ),
      })
      .eq("id", guild.id);
    if (updateError) return databaseFailure(updateError.code);

    revalidatePath("/configuracoes");
    return published.pinError
      ? {
          ok: true,
          message:
            "Vitrine publicada, mas não foi possível fixá-la. Dê ao bot a permissão Fixar mensagens e salve novamente.",
        }
      : {
          ok: true,
          message: `Vitrine publicada e fixada em #${published.configuration.channel_name}.`,
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido.";
    console.error(`[admin:discord-storefront] ${message}`);
    return {
      ok: false,
      message: storefrontActionError(message),
    };
  }
}

function storefrontActionError(message: string) {
  if (message.includes("DISCORD_BOT_TOKEN")) {
    return "O bot Discord ainda não está configurado no servidor.";
  }
  if (message.startsWith("Discord recusou") || message.startsWith("Resposta")) {
    return message;
  }
  if (message.includes("catálogo") || message.includes("consultar")) {
    return "Não foi possível carregar o catálogo para publicar a vitrine.";
  }
  return "Não foi possível publicar a vitrine agora. Tente novamente.";
}

export async function archiveRecordAction(
  target: string,
  id: string,
): Promise<AdminActionState> {
  const parsed = z.object({ target: archiveTargetSchema, id: uuidSchema }).safeParse({ target, id });
  if (!parsed.success) return { ok: false, message: "Registro inválido." };

  const { supabase } = await actionContext();
  const now = new Date().toISOString();
  const result = parsed.data.target === "game"
    ? await supabase
        .from("games")
        .update({ status: "archived", archived_at: now })
        .eq("id", parsed.data.id)
        .is("archived_at", null)
        .select("id")
        .maybeSingle()
    : parsed.data.target === "substore"
      ? await supabase
          .from("substores")
          .update({ status: "archived", archived_at: now })
          .eq("id", parsed.data.id)
          .is("archived_at", null)
          .select("id")
          .maybeSingle()
      : parsed.data.target === "product"
        ? await supabase
            .from("products")
            .update({ status: "archived", archived_at: now })
            .eq("id", parsed.data.id)
            .is("archived_at", null)
            .select("id")
            .maybeSingle()
        : await supabase
            .from("whitelist_entries")
            .update({ is_active: false, archived_at: now })
            .eq("id", parsed.data.id)
            .is("archived_at", null)
            .select("id")
            .maybeSingle();
  const { data, error } = result;
  if (error) return databaseFailure(error.code);
  if (!data) {
    const existing = parsed.data.target === "game"
      ? await supabase.from("games").select("archived_at").eq("id", parsed.data.id).maybeSingle()
      : parsed.data.target === "substore"
        ? await supabase.from("substores").select("archived_at").eq("id", parsed.data.id).maybeSingle()
        : parsed.data.target === "product"
          ? await supabase.from("products").select("archived_at").eq("id", parsed.data.id).maybeSingle()
          : await supabase
              .from("whitelist_entries")
              .select("archived_at")
              .eq("id", parsed.data.id)
              .maybeSingle();
    if (existing.error) return databaseFailure(existing.error.code);
    if (existing.data?.archived_at) {
      return { ok: true, message: "Registro já estava arquivado." };
    }
    return { ok: false, message: "Registro não encontrado." };
  }
  revalidatePath("/catalogo/jogos");
  revalidatePath("/catalogo/sublojas");
  revalidatePath("/catalogo/produtos");
  revalidatePath("/whitelist");
  revalidatePath("/dashboard");
  return { ok: true, message: "Registro arquivado." };
}

export async function changeInventoryStatusAction(
  input: z.input<typeof inventoryStatusChangeSchema>,
): Promise<AdminActionState> {
  const parsed = inventoryStatusChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Alteração de estoque inválida." };

  const { supabase } = await actionContext();
  const { error } = await supabase.rpc("admin_change_inventory_status", {
    p_unit_id: parsed.data.unitId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });
  if (error) return databaseFailure(error.code);
  revalidatePath("/estoque");
  revalidatePath("/dashboard");
  return { ok: true, message: "Estado da unidade atualizado." };
}
