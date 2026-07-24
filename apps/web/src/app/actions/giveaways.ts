"use server";

import { randomBytes, randomInt } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminActionState } from "@/app/actions/admin";
import { requireAdmin } from "@/lib/auth";
import { listDiscordGuildChannels } from "@/lib/bot/discord-storefront";
import {
  deleteGiveawayWinnerTicketChannel,
  publishGiveawayAnnouncement,
  publishGiveawayRerollAnnouncement,
  publishGiveawayResultAnnouncement,
} from "@/lib/giveaways/discord";
import { getDiscordGuildMembership } from "@/lib/giveaways/discord-membership";
import { reconcileGiveaways } from "@/lib/giveaways/reconciliation";
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
  endsAt: z.string().datetime(),
  requiredValidInvites: z.number().int().min(0).max(100),
  minimumAccountAgeDays: z.number().int().min(0).max(3_650),
  minimumStayMinutes: z.number().int().min(0).max(43_200),
  prizes: z.array(z.object({
    productId: z.string().uuid("Produto inválido."),
    quantity: z.number().int().min(1).max(10_000),
  })).min(1).max(20),
}).superRefine((value, context) => {
  const now = Date.now();
  if (Date.parse(value.endsAt) <= now) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "O encerramento deve estar no futuro." });
  }
  if (Date.parse(value.endsAt) > now + 90 * 24 * 60 * 60 * 1_000) {
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
      .rpc("admin_create_giveaway_v2", {
        p_public_slug: randomBytes(8).toString("hex"),
        p_guild_id: parsed.data.guildId,
        p_publication_channel_id: publicationChannel.id,
        p_publication_channel_name: publicationChannel.name,
        p_ticket_category_id: ticketCategory?.id ?? null,
        p_ticket_category_name: ticketCategory?.name ?? null,
        p_title: parsed.data.title,
        p_description: parsed.data.description,
        p_rules_text: parsed.data.rulesText,
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
        ? "Sorteio iniciado, estoque reservado e anúncio publicado."
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

export async function rerollGiveawayWinnersAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const giveawayId = text(formData, "giveawayId");
  const winnerIds = formData.getAll("winnerId")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
  if (!UUID_PATTERN.test(giveawayId)) return { ok: false, message: "Sorteio inválido." };
  if (
    winnerIds.length < 1
    || winnerIds.length > 100
    || winnerIds.some((winnerId) => !UUID_PATTERN.test(winnerId))
    || new Set(winnerIds).size !== winnerIds.length
  ) {
    return { ok: false, message: "Selecione ao menos um ganhador válido para resortear." };
  }

  try {
    await requireAdmin();
    const sessionClient = await createServerSupabaseClient();
    const adminClient = createAdminSupabaseClient();
    if (!sessionClient || !adminClient) throw new Error("Supabase não configurado.");

    const { data: giveaway, error: giveawayError } = await adminClient
      .from("giveaways")
      .select("id,guild_id,status,required_valid_invites")
      .eq("id", giveawayId)
      .maybeSingle();
    if (giveawayError || !giveaway) return { ok: false, message: "Sorteio não encontrado." };
    if (giveaway.status !== "completed") {
      return { ok: false, message: "Somente sorteios concluídos podem ser resorteados." };
    }

    const [guildResult, winnerResult, historyResult, entryResult] = await Promise.all([
      adminClient
        .from("guilds")
        .select("discord_guild_id")
        .eq("id", giveaway.guild_id)
        .maybeSingle(),
      adminClient
        .from("giveaway_winners")
        .select("id,entry_id")
        .eq("giveaway_id", giveawayId),
      adminClient
        .from("giveaway_winner_history")
        .select("entry_id")
        .eq("giveaway_id", giveawayId),
      adminClient
        .from("giveaway_entries")
        .select("id,discord_user_id")
        .eq("giveaway_id", giveawayId)
        .eq("membership_is_valid", true)
        .gte("valid_invite_count", giveaway.required_valid_invites)
        .limit(1_000),
    ]);
    if (
      guildResult.error
      || !guildResult.data
      || winnerResult.error
      || historyResult.error
      || entryResult.error
    ) {
      throw new Error("Não foi possível carregar os candidatos do resorteio.");
    }

    const activeWinners = winnerResult.data ?? [];
    const activeWinnerIds = new Set(activeWinners.map((winner) => winner.id));
    if (winnerIds.some((winnerId) => !activeWinnerIds.has(winnerId))) {
      return { ok: false, message: "A lista de ganhadores mudou. Atualize a página e tente novamente." };
    }
    const excludedEntryIds = new Set([
      ...activeWinners.map((winner) => winner.entry_id),
      ...(historyResult.data ?? []).map((winner) => winner.entry_id),
    ]);
    const candidates = shuffled(
      (entryResult.data ?? []).filter((entry) => !excludedEntryIds.has(entry.id)),
    );
    const replacements: string[] = [];
    for (const candidate of candidates) {
      const membership = await getDiscordGuildMembership(
        guildResult.data.discord_guild_id,
        candidate.discord_user_id,
      );
      if (membership.exists && !membership.pending) {
        replacements.push(candidate.id);
        if (replacements.length === winnerIds.length) break;
      } else {
        await adminClient
          .from("giveaway_entries")
          .update({
            membership_is_valid: false,
            membership_invalid_reason: membership.exists
              ? "Não concluiu a verificação do servidor."
              : "Não faz mais parte do servidor.",
            membership_checked_at: new Date().toISOString(),
          })
          .eq("id", candidate.id);
      }
    }
    if (replacements.length < winnerIds.length) {
      return {
        ok: false,
        message: `Só há ${replacements.length} participante(s) ainda válido(s) disponível(is) para substituir ${winnerIds.length} ganhador(es).`,
      };
    }

    const { data: rerolled, error: rerollError } = await sessionClient.rpc(
      "admin_reroll_giveaway_winners",
      {
        p_giveaway_id: giveawayId,
        p_winner_ids: winnerIds,
        p_replacement_entry_ids: replacements,
      },
    );
    if (rerollError || !rerolled?.length) return createDatabaseError(rerollError?.message);
    const rerollId = rerolled[0].reroll_id;
    let deferredWork = 0;

    for (const replacement of rerolled) {
      if (!replacement.replaced_ticket_channel_id) continue;
      try {
        await deleteGiveawayWinnerTicketChannel(replacement.replaced_ticket_channel_id);
        const { error } = await adminClient.rpc("record_giveaway_reroll_ticket_cleanup", {
          p_history_id: replacement.history_id,
          p_claim_token: rerollId,
          p_error: null,
        });
        if (error) throw new Error(error.message);
      } catch (error) {
        deferredWork += 1;
        await adminClient.rpc("record_giveaway_reroll_ticket_cleanup", {
          p_history_id: replacement.history_id,
          p_claim_token: rerollId,
          p_error: error instanceof Error ? error.message : "Falha ao excluir ticket antigo.",
        });
      }
    }

    const announcementInput = await getGiveawayAnnouncementInput(giveawayId);
    const publicationResults = await Promise.allSettled([
      publishAndRecord(giveawayId),
      publishResultAndRecord(giveawayId),
      publishRerollAndRecord(rerollId, announcementInput),
    ]);
    deferredWork += publicationResults.filter((result) => result.status === "rejected").length;

    const reconciliation = await reconcileGiveaways({ client: adminClient }).catch((error) => {
      console.error(`[admin:giveaway:reroll-reconcile] ${error instanceof Error ? error.message : "erro desconhecido"}`);
      return null;
    });
    if (!reconciliation || reconciliation.failures > 0) deferredWork += 1;
    const { data: replacementTickets, error: replacementTicketError } = await adminClient
      .from("giveaway_winners")
      .select("id,ticket_status")
      .in("id", rerolled.map((replacement) => replacement.new_winner_id));
    if (
      replacementTicketError
      || replacementTickets?.length !== rerolled.length
      || replacementTickets.some((winner) => winner.ticket_status !== "open")
    ) {
      deferredWork += 1;
    }

    revalidatePath("/sorteios");
    revalidatePath(`/sorteios/${announcementInput.publicSlug}`);
    return {
      ok: true,
      message: deferredWork
        ? `${winnerIds.length} ganhador(es) substituído(s). Anúncios e tickets pendentes serão concluídos automaticamente.`
        : `${winnerIds.length} ganhador(es) substituído(s), anúncios atualizados e novos tickets abertos.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[admin:giveaway:reroll] ${message}`);
    return { ok: false, message: "Não foi possível concluir o resorteio agora." };
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

async function publishResultAndRecord(giveawayId: string) {
  const input = await getGiveawayAnnouncementInput(giveawayId);
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado.");
  try {
    const result = await publishGiveawayResultAnnouncement(input);
    const { error } = await client.rpc("record_giveaway_result_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: result.messageId,
      p_error: null,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    await client.rpc("record_giveaway_result_publication", {
      p_giveaway_id: giveawayId,
      p_message_id: null,
      p_error: error instanceof Error ? error.message : "Falha ao publicar resultado.",
    });
    throw error;
  }
}

async function publishRerollAndRecord(
  rerollId: string,
  input: Awaited<ReturnType<typeof getGiveawayAnnouncementInput>>,
) {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase não configurado.");
  try {
    const result = await publishGiveawayRerollAnnouncement(
      input,
      { id: rerollId, messageId: null },
    );
    const { error } = await client.rpc("record_giveaway_reroll_publication", {
      p_reroll_id: rerollId,
      p_message_id: result.messageId,
      p_error: null,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (error) {
    await client.rpc("record_giveaway_reroll_publication", {
      p_reroll_id: rerollId,
      p_message_id: null,
      p_error: error instanceof Error ? error.message : "Falha ao anunciar resorteio.",
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
  if (message?.includes("Only completed giveaways")) {
    return { ok: false, message: "Somente sorteios concluídos podem ser resorteados." };
  }
  if (message?.includes("deixou de ser elegível")) {
    return { ok: false, message: "Um substituto deixou de ser elegível. Tente novamente." };
  }
  if (message?.includes("still being created")) {
    return { ok: false, message: "Um ticket ainda está sendo criado. Aguarde alguns segundos e tente novamente." };
  }
  if (message?.includes("já foi ganhador")) {
    return { ok: false, message: "O sistema recusou repetir um ganhador anterior." };
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

function shuffled<T>(values: T[]) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
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
