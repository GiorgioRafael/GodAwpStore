"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { listDiscordGuildChannels } from "@/lib/bot/discord-storefront";
import { publishGiveawayAnnouncement } from "@/lib/giveaways/discord";
import { getGiveawayAnnouncementInput } from "@/lib/giveaways/repository";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const giveawaySchema = z.object({
  guildId: z.string().uuid("Servidor inválido."),
  publicationChannelId: z.string().regex(/^[0-9]{15,22}$/, "Canal inválido."),
  ticketCategoryId: z.string().regex(/^[0-9]{15,22}$/).nullable(),
  title: z.string().trim().min(3, "Informe um título.").max(120),
  description: z.string().trim().max(2_000),
  rulesText: z.string().trim().max(2_000),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  requiredValidInvites: z.number().int().min(0).max(100),
  minimumAccountAgeDays: z.number().int().min(0).max(3_650),
  minimumStayMinutes: z.number().int().min(0).max(43_200),
  prizes: z.array(z.object({
    productId: z.string().uuid("Produto inválido."),
    quantity: z.number().int().min(1).max(10_000),
  })).min(1).max(20),
}).superRefine((value, context) => {
  if (Date.parse(value.endsAt) <= Math.max(Date.parse(value.startsAt), Date.now())) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "O encerramento deve estar no futuro." });
  }
  if (Date.parse(value.endsAt) > Date.parse(value.startsAt) + 90 * 24 * 60 * 60 * 1_000) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "A duração máxima é de 90 dias." });
  }
  if (new Set(value.prizes.map((prize) => prize.productId)).size !== value.prizes.length) {
    context.addIssue({ code: "custom", path: ["prizes"], message: "Não repita produtos no pacote." });
  }
});

export async function createGiveawayAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const productIds = formData.getAll("prizeProductId");
  const quantities = formData.getAll("prizeQuantity");
  const parsed = giveawaySchema.safeParse({
    guildId: text(formData, "guildId"),
    publicationChannelId: text(formData, "publicationChannelId"),
    ticketCategoryId: text(formData, "ticketCategoryId") || null,
    title: text(formData, "title"),
    description: text(formData, "description"),
    rulesText: text(formData, "rulesText"),
    startsAt: localDateTimeToIso(text(formData, "startsAt")),
    endsAt: localDateTimeToIso(text(formData, "endsAt")),
    requiredValidInvites: integer(formData, "requiredValidInvites"),
    minimumAccountAgeDays: integer(formData, "minimumAccountAgeDays"),
    minimumStayMinutes: Math.round(integer(formData, "minimumStayHours") * 60),
    prizes: productIds.map((productId, index) => ({
      productId: typeof productId === "string" ? productId : "",
      quantity: Number(quantities[index]),
    })),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revise a configuração do sorteio.",
      fieldErrors: zodErrors(parsed.error),
    };
  }

  try {
    await requireAdmin();
    const sessionClient = await createServerSupabaseClient();
    const adminClient = createAdminSupabaseClient();
    if (!sessionClient || !adminClient) throw new Error("Supabase não configurado.");
    const { data: guild, error: guildError } = await adminClient
      .from("guilds")
      .select("id,discord_guild_id")
      .eq("id", parsed.data.guildId)
      .eq("status", "active")
      .is("archived_at", null)
      .maybeSingle();
    if (guildError || !guild) return { ok: false, message: "Servidor ativo não encontrado." };
    const channels = await listDiscordGuildChannels(guild.discord_guild_id);
    const publicationChannel = channels.textChannels.find(
      (channel) => channel.id === parsed.data.publicationChannelId,
    );
    const ticketCategory = parsed.data.ticketCategoryId
      ? channels.categories.find((category) => category.id === parsed.data.ticketCategoryId)
      : null;
    if (!publicationChannel) {
      return { ok: false, message: "O bot não acessa o canal de publicação selecionado." };
    }
    if (parsed.data.ticketCategoryId && !ticketCategory) {
      return { ok: false, message: "A categoria de tickets não pertence ao servidor." };
    }

    const { data, error } = await sessionClient
      .rpc("admin_create_giveaway", {
        p_public_slug: randomBytes(8).toString("hex"),
        p_guild_id: parsed.data.guildId,
        p_publication_channel_id: publicationChannel.id,
        p_publication_channel_name: publicationChannel.name,
        p_ticket_category_id: ticketCategory?.id ?? null,
        p_ticket_category_name: ticketCategory?.name ?? null,
        p_title: parsed.data.title,
        p_description: parsed.data.description,
        p_rules_text: parsed.data.rulesText,
        p_starts_at: parsed.data.startsAt,
        p_ends_at: parsed.data.endsAt,
        p_required_valid_invites: parsed.data.requiredValidInvites,
        p_minimum_account_age_days: parsed.data.minimumAccountAgeDays,
        p_minimum_stay_minutes: parsed.data.minimumStayMinutes,
        p_prizes: parsed.data.prizes.map((prize) => ({
          product_id: prize.productId,
          quantity: prize.quantity,
        })),
      })
      .single();
    if (error || !data) return createDatabaseError(error?.message);

    const publication = await publishAndRecord(data.created_giveaway_id).catch((error) => {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[admin:giveaway:publish] ${message}`);
      return false;
    });
    revalidatePath("/sorteios");
    revalidatePath("/estoque");
    return {
      ok: true,
      message: publication
        ? "Sorteio criado, estoque reservado e anúncio publicado."
        : "Sorteio criado e estoque reservado, mas o anúncio precisa ser republicado.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:giveaway:create] ${message}`);
    return { ok: false, message: "Não foi possível criar o sorteio agora." };
  }
}

export async function cancelGiveawayAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const giveawayId = text(formData, "giveawayId");
  if (!UUID_PATTERN.test(giveawayId)) return { ok: false, message: "Sorteio inválido." };
  try {
    await requireAdmin();
    const client = await createServerSupabaseClient();
    if (!client) throw new Error("Supabase não configurado.");
    const { error } = await client.rpc("admin_cancel_giveaway", {
      p_giveaway_id: giveawayId,
    });
    if (error) return createDatabaseError(error.message);
    await publishAndRecord(giveawayId).catch(() => false);
    revalidatePath("/sorteios");
    revalidatePath("/estoque");
    return { ok: true, message: "Sorteio cancelado e estoque devolvido." };
  } catch (error) {
    console.error(`[admin:giveaway:cancel] ${error instanceof Error ? error.message : "erro desconhecido"}`);
    return { ok: false, message: "Não foi possível cancelar o sorteio." };
  }
}

export async function republishGiveawayAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const giveawayId = text(formData, "giveawayId");
  if (!UUID_PATTERN.test(giveawayId)) return { ok: false, message: "Sorteio inválido." };
  try {
    await requireAdmin();
    const published = await publishAndRecord(giveawayId);
    revalidatePath("/sorteios");
    return published
      ? { ok: true, message: "Anúncio do sorteio atualizado no Discord." }
      : { ok: false, message: "Não foi possível atualizar o anúncio." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:giveaway:republish] ${message}`);
    return { ok: false, message: "Não foi possível publicar no Discord." };
  }
}

async function publishAndRecord(giveawayId: string) {
  const input = await getGiveawayAnnouncementInput(giveawayId);
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado.");
  try {
    const result = await publishGiveawayAnnouncement(input);
    const { error } = await client.rpc("record_giveaway_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: result.messageId,
      p_error: null,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao publicar.";
    await client.rpc("record_giveaway_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: null,
      p_error: message,
    });
    throw error;
  }
}

function createDatabaseError(message?: string): AdminActionState {
  if (message?.includes("Insufficient stock")) {
    return { ok: false, message: "O estoque de um dos prêmios não é suficiente." };
  }
  if (message?.includes("Completed giveaway")) {
    return { ok: false, message: "Um sorteio concluído não pode ser cancelado." };
  }
  if (message?.includes("duplicate") || message?.includes("unique")) {
    return { ok: false, message: "Há produtos repetidos ou um identificador já usado." };
  }
  return { ok: false, message: "Não foi possível salvar o sorteio." };
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function integer(formData: FormData, name: string) {
  return Number(text(formData, name));
}

function localDateTimeToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const timestamp = Date.parse(`${value}:00-03:00`);
  return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString();
}

function zodErrors(error: z.ZodError) {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] = [...(result[key] ?? []), issue.message];
  }
  return result;
}
