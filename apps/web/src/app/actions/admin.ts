"use server";

import {
  gameInputSchema,
  isoDateTimeSchema,
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
import { withBoosterDiscountConfiguration } from "@/lib/bot/booster-discount";
import {
  listDiscordTextChannels,
  publishDiscordStorefront,
  readStorefrontConfiguration,
  withStorefrontConfiguration,
} from "@/lib/bot/discord-storefront";
import { synchronizePublishedDiscordStorefronts } from "@/lib/bot/discord-storefront-sync";
import { synchronizeDiscordProductEmojis } from "@/lib/bot/discord-product-emojis";
import { DISCORD_STOREFRONT_PRODUCT_LIMIT } from "@/lib/bot/discord-product-emoji-shared";
import { synchronizeAllOpenDiscordTicketControls } from "@/lib/bot/discord-ticket-controls-sync";
import { botMessageCustomizationToJson } from "@/lib/bot/message-customization";
import { botMessageCustomizationSchema } from "@/lib/bot/message-customization-validation";
import { loadBotMessageCustomization } from "@/lib/bot/message-customization-server";
import { SupabaseBotCommerceRepository } from "@/lib/bot/supabase-repository";
import { ticketCloseAdminDiscordUserIdsSchema } from "@/lib/bot/ticket-close-admins-validation";
import { ticketNotificationDiscordUserIdsSchema } from "@/lib/bot/ticket-notifications-validation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
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
const productOrderSchema = z
  .array(uuidSchema)
  .min(1, "A lista de produtos está vazia.")
  .max(500, "A lista de produtos é grande demais.")
  .refine((productIds) => new Set(productIds).size === productIds.length, {
    message: "A lista de produtos contém itens repetidos.",
  });
const discordStorefrontSchema = z.object({
  guildId: uuidSchema,
  channelId: z.string().regex(/^[0-9]{15,22}$/, "Canal Discord inválido."),
  boosterDiscountEnabled: z.boolean(),
  boosterDiscountBps: z.number().int().min(1, "Informe um desconto maior que zero.").max(9_000, "O desconto máximo é 90%."),
  boosterMinimumSubtotalCents: z.number().int().min(100, "A compra mínima deve ser de pelo menos R$ 1,00."),
}).superRefine((value, context) => {
  const discountedMinimum = Number(
    BigInt(value.boosterMinimumSubtotalCents) * BigInt(10_000 - value.boosterDiscountBps) / 10_000n,
  );
  if (discountedMinimum < 100) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["boosterMinimumSubtotalCents"],
      message: "A compra mínima precisa manter o Pix final em pelo menos R$ 1,00.",
    });
  }
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

async function synchronizeCatalogStorefront(savedMessage: string): Promise<AdminActionState> {
  try {
    const storefronts = await synchronizePublishedDiscordStorefronts();
    if (storefronts.failed > 0) {
      return {
        ok: true,
        message: `${savedMessage} ${storefronts.failed} vitrine(s) do Discord não puderam ser atualizadas.`,
      };
    }
    if (storefronts.productEmojiFailures > 0) {
      return {
        ok: true,
        message: `${savedMessage} A vitrine foi atualizada, mas ${storefronts.productEmojiFailures} ícone(s) de produto não puderam ser sincronizados.`,
      };
    }
    if (storefronts.published > 0) {
      return {
        ok: true,
        message: `${savedMessage} Vitrine do Discord sincronizada.`,
      };
    }
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "erro desconhecido";
    console.error(`[admin:product-storefront-sync] ${message}`);
    return {
      ok: true,
      message: `${savedMessage} A vitrine do Discord não pôde ser atualizada agora.`,
    };
  }
  return { ok: true, message: savedMessage };
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
    stockQuantity: integer(formData, "stockQuantity"),
    imageUrl: nullableText(formData, "imageUrl"),
    status: text(formData, "status") || "active",
    sortOrder: integer(formData, "sortOrder"),
    lowStockThreshold: integer(formData, "lowStockThreshold", 5),
  });
  const parsedId = text(formData, "id") ? uuidSchema.safeParse(text(formData, "id")) : null;
  const parsedUpdatedAt = parsedId?.success
    ? isoDateTimeSchema.safeParse(text(formData, "updatedAt"))
    : null;

  if (!parsed.success || (parsedId && !parsedId.success)) {
    const fieldErrors = parsed.success ? { id: ["ID inválido."] } : errorsFromZod(parsed.error);
    if (!Number.isFinite(minimumPriceCents)) fieldErrors.minimumPrice = ["Informe um valor como 10,00."];
    return { ok: false, message: "Revise os campos do produto.", fieldErrors };
  }
  if (parsedId?.success && !parsedUpdatedAt?.success) {
    return {
      ok: false,
      message: "Reabra o produto antes de salvar o estoque.",
      fieldErrors: { stockQuantity: ["A versão carregada do produto é inválida."] },
    };
  }

  const { identity, supabase } = await actionContext();
  const id = parsedId?.success ? parsedId.data : null;
  if (parsed.data.status === "active") {
    let activeProductsQuery = supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .is("archived_at", null);
    if (id) activeProductsQuery = activeProductsQuery.neq("id", id);
    const { count, error: countError } = await activeProductsQuery;
    if (countError) return databaseFailure(countError.code);
    if ((count ?? 0) >= DISCORD_STOREFRONT_PRODUCT_LIMIT) {
      return {
        ok: false,
        message: `A vitrine aceita no máximo ${DISCORD_STOREFRONT_PRODUCT_LIMIT} produtos ativos.`,
        fieldErrors: {
          status: ["Desative ou arquive outro produto antes de ativar este."],
        },
      };
    }
  }
  const record = {
    substore_id: parsed.data.substoreId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description,
    minimum_price_cents: parsed.data.minimumPriceCents,
    stock_quantity: parsed.data.stockQuantity,
    image_url: parsed.data.imageUrl,
    status: parsed.data.status,
    sort_order: parsed.data.sortOrder,
    low_stock_threshold: parsed.data.lowStockThreshold,
    archived_at: parsed.data.status === "archived" ? new Date().toISOString() : null,
  };
  const operation = id
    ? supabase
        .from("products")
        .update(record)
        .eq("id", id)
        .eq("updated_at", text(formData, "updatedAt"))
        .select("id")
        .maybeSingle()
    : supabase
        .from("products")
        .insert({ ...record, created_by: identity.authUserId })
        .select("id")
        .single();
  const { data, error } = await operation;
  if (error) {
    if (error.code === "23514" && error.message.includes("products_active_limit")) {
      return {
        ok: false,
        message: `A vitrine aceita no máximo ${DISCORD_STOREFRONT_PRODUCT_LIMIT} produtos ativos.`,
        fieldErrors: {
          status: ["Desative ou arquive outro produto antes de ativar este."],
        },
      };
    }
    return databaseFailure(error.code);
  }
  if (!data) {
    return {
      ok: false,
      message: "O estoque mudou durante a edição. Reabra o produto para não sobrescrever uma compra.",
    };
  }
  revalidatePath("/catalogo/produtos");
  revalidatePath("/estoque");
  revalidatePath("/dashboard");
  const savedMessage = id ? "Produto e estoque atualizados." : "Produto e estoque criados.";
  return synchronizeCatalogStorefront(savedMessage);
}

export async function saveProductOrderAction(formData: FormData): Promise<AdminActionState> {
  let rawProductIds: unknown;
  try {
    rawProductIds = JSON.parse(text(formData, "productIds"));
  } catch {
    return { ok: false, message: "A ordem recebida é inválida. Recarregue a página." };
  }

  const parsed = productOrderSchema.safeParse(rawProductIds);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "A ordem recebida é inválida.",
    };
  }

  const { supabase } = await actionContext();
  const { data, error } = await supabase.rpc("admin_reorder_products", {
    p_product_ids: parsed.data,
  });

  if (error) {
    if (error.code === "40001" || error.message.includes("products_order_stale")) {
      return {
        ok: false,
        message: "A lista de produtos mudou enquanto você organizava. Recarregue a página e tente novamente.",
      };
    }
    if (error.code === "22023" || error.message.includes("products_order_invalid")) {
      return { ok: false, message: "A ordem recebida é inválida. Recarregue a página." };
    }
    return databaseFailure(error.code);
  }
  if (data !== parsed.data.length) {
    return { ok: false, message: "Nem todos os produtos foram reordenados. Recarregue a página." };
  }

  revalidatePath("/catalogo/produtos");
  return synchronizeCatalogStorefront("Ordem dos produtos salva.");
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
  const { data, error } = await supabase
    .from("platform_settings")
    .update({
      currency_code: "BRL",
      global_commission_bps: parsed.data.globalCommissionBps,
      display_timezone: "America/Sao_Paulo",
      updated_by: identity.authUserId,
    })
    .eq("id", 1)
    .select("id")
    .maybeSingle();
  if (error) return databaseFailure(error.code);
  if (!data) return { ok: false, message: "Configurações globais não encontradas." };

  revalidatePath("/configuracoes");
  revalidatePath("/whitelist");
  return { ok: true, message: "Configurações atualizadas." };
}

export async function saveBotMessageCustomizationAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const expectedUpdatedAt = isoDateTimeSchema.safeParse(text(formData, "expectedUpdatedAt"));
  let rawConfig: unknown;
  let rawNotificationDiscordUserIds: unknown;
  let rawTicketCloseAdminDiscordUserIds: unknown;
  try {
    rawConfig = JSON.parse(text(formData, "config"));
  } catch {
    return {
      ok: false,
      message: "A personalização enviada é inválida. Recarregue a página e tente novamente.",
      fieldErrors: { config: ["JSON inválido."] },
    };
  }
  try {
    rawNotificationDiscordUserIds = JSON.parse(text(formData, "notificationDiscordUserIds"));
  } catch {
    return {
      ok: false,
      message: "A lista de notificações enviada é inválida. Recarregue a página e tente novamente.",
      fieldErrors: { notificationDiscordUserIds: ["Lista inválida."] },
    };
  }
  try {
    rawTicketCloseAdminDiscordUserIds = JSON.parse(
      text(formData, "ticketCloseAdminDiscordUserIds"),
    );
  } catch {
    return {
      ok: false,
      message:
        "A lista de administradores de fechamento é inválida. Recarregue a página e tente novamente.",
      fieldErrors: { ticketCloseAdminDiscordUserIds: ["Lista inválida."] },
    };
  }

  const parsed = botMessageCustomizationSchema.safeParse(rawConfig);
  const parsedNotificationDiscordUserIds =
    ticketNotificationDiscordUserIdsSchema.safeParse(rawNotificationDiscordUserIds);
  const parsedTicketCloseAdminDiscordUserIds =
    ticketCloseAdminDiscordUserIdsSchema.safeParse(rawTicketCloseAdminDiscordUserIds);
  if (
    !parsed.success ||
    !parsedNotificationDiscordUserIds.success ||
    !parsedTicketCloseAdminDiscordUserIds.success ||
    !expectedUpdatedAt.success
  ) {
    const configMessages = parsed.success
      ? []
      : [...new Set(parsed.error.issues.map((issue) => issue.message))].slice(0, 4);
    const notificationMessages = parsedNotificationDiscordUserIds.success
      ? []
      : [
          ...new Set(
            parsedNotificationDiscordUserIds.error.issues.map((issue) => issue.message),
          ),
        ].slice(0, 4);
    const closeAdminMessages = parsedTicketCloseAdminDiscordUserIds.success
      ? []
      : [
          ...new Set(
            parsedTicketCloseAdminDiscordUserIds.error.issues.map((issue) => issue.message),
          ),
        ].slice(0, 4);
    return {
      ok: false,
      message: expectedUpdatedAt.success
        ? "Revise os campos destacados antes de salvar."
        : "As configurações mudaram desde que esta página foi aberta. Recarregue para continuar.",
      fieldErrors: {
        ...(configMessages.length > 0 ? { config: configMessages } : {}),
        ...(notificationMessages.length > 0
          ? { notificationDiscordUserIds: notificationMessages }
          : {}),
        ...(closeAdminMessages.length > 0
          ? { ticketCloseAdminDiscordUserIds: closeAdminMessages }
          : {}),
        ...(!expectedUpdatedAt.success &&
        configMessages.length === 0 &&
        notificationMessages.length === 0 &&
        closeAdminMessages.length === 0
          ? { config: ["Versão carregada inválida."] }
          : {}),
      },
    };
  }

  const { identity, supabase } = await actionContext();
  const { data, error } = await supabase
    .from("platform_settings")
    .update({
      bot_message_config: botMessageCustomizationToJson(parsed.data),
      ticket_notification_discord_user_ids: parsedNotificationDiscordUserIds.data,
      ticket_close_admin_discord_user_ids: parsedTicketCloseAdminDiscordUserIds.data,
      updated_by: identity.authUserId,
    })
    .eq("id", 1)
    .eq("updated_at", expectedUpdatedAt.data)
    .select("id")
    .maybeSingle();
  if (error) return databaseFailure(error.code);
  if (!data) {
    return {
      ok: false,
      message: "Outro administrador salvou alterações primeiro. Recarregue a página para fazer o merge.",
    };
  }

  revalidatePath("/customizacao-bot");

  const [storefrontSync, ticketControlsSync] = await Promise.allSettled([
    synchronizePublishedDiscordStorefronts(),
    synchronizeAllOpenDiscordTicketControls(),
  ]);
  const warnings: string[] = [];

  if (storefrontSync.status === "rejected") {
    const message =
      storefrontSync.reason instanceof Error
        ? storefrontSync.reason.message
        : "erro desconhecido";
    console.error(`[admin:bot-customization-storefront-sync] ${message}`);
    warnings.push("As vitrines não puderam ser atualizadas agora.");
  } else if (storefrontSync.value.failed > 0) {
    warnings.push(
      `${storefrontSync.value.failed} vitrine(s) não puderam ser atualizadas agora.`,
    );
  }
  if (
    storefrontSync.status === "fulfilled" &&
    storefrontSync.value.productEmojiFailures > 0
  ) {
    warnings.push(
      `${storefrontSync.value.productEmojiFailures} ícone(s) de produto não puderam ser sincronizados agora.`,
    );
  }

  if (ticketControlsSync.status === "rejected") {
    const message =
      ticketControlsSync.reason instanceof Error
        ? ticketControlsSync.reason.message
        : "erro desconhecido";
    console.error(`[admin:bot-customization-ticket-sync] ${message}`);
    warnings.push("Os controles dos tickets abertos não puderam ser atualizados agora.");
  } else if (ticketControlsSync.value.failed > 0) {
    warnings.push(
      `${ticketControlsSync.value.failed} ticket(s) aberto(s) não puderam receber os novos controles agora.`,
    );
  }

  if (warnings.length > 0) {
    return { ok: true, message: `Personalização salva. ${warnings.join(" ")}` };
  }

  if (storefrontSync.status === "fulfilled" && storefrontSync.value.published > 0) {
    return {
      ok: true,
      message: "Personalização salva e vitrines publicadas atualizadas.",
    };
  }

  return { ok: true, message: "Personalização do bot salva." };
}

export async function publishDiscordStorefrontAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let boosterMinimumSubtotalCents = Number.NaN;
  try {
    boosterMinimumSubtotalCents = parseBrlToCents(text(formData, "boosterMinimumSubtotal"));
  } catch {
    // A validação abaixo devolve a mensagem no campo correto.
  }
  const parsed = discordStorefrontSchema.safeParse({
    guildId: text(formData, "guildId"),
    channelId: text(formData, "channelId"),
    boosterDiscountEnabled: formData.get("boosterDiscountEnabled") === "on",
    boosterDiscountBps: percentageToBps(text(formData, "boosterDiscountPercent")),
    boosterMinimumSubtotalCents,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise o canal e as regras de desconto para boosters.",
      fieldErrors: {
        ...errorsFromZod(parsed.error),
        ...(!Number.isFinite(boosterMinimumSubtotalCents)
          ? { boosterMinimumSubtotal: ["Informe um valor como 50,00."] }
          : {}),
      },
    };
  }

  try {
    await requireAdmin();
    const supabase = createAdminSupabaseClient();
    if (!supabase) throw new Error("Supabase server-only não configurado.");
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

    const emojiSync = await synchronizeDiscordProductEmojis(supabase);
    const [catalog, customization] = await Promise.all([
      new BotCommerceService(new SupabaseBotCommerceRepository()).listCatalog(),
      loadBotMessageCustomization(supabase),
    ]);
    const published = await publishDiscordStorefront({
      channel,
      catalog,
      customization,
      previous: readStorefrontConfiguration(guild.configuration),
    });

    const { data: updatedGuild, error: updateError } = await supabase
      .from("guilds")
      .update({
        configuration: withBoosterDiscountConfiguration(
          withStorefrontConfiguration(
            guild.configuration,
            published.configuration,
          ),
          {
            enabled: parsed.data.boosterDiscountEnabled,
            discount_bps: parsed.data.boosterDiscountBps,
            minimum_subtotal_cents: parsed.data.boosterMinimumSubtotalCents,
          },
        ),
      })
      .eq("id", guild.id)
      .select("id")
      .maybeSingle();
    if (updateError) return databaseFailure(updateError.code);
    if (!updatedGuild) return { ok: false, message: "Servidor Discord não encontrado ao salvar." };

    revalidatePath("/configuracoes");
    return {
      ok: true,
      message: `Vitrine e desconto de boosters atualizados em #${published.configuration.channel_name}.${
        emojiSync.failed > 0
          ? ` ${emojiSync.failed} ícone(s) de produto não puderam ser sincronizados.`
          : ""
      }`,
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
