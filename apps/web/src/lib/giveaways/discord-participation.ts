import "server-only";

import { discordApiUrl } from "@/lib/bot/discord-api";
import { readDiscordInteraction } from "@/lib/bot/discord-context";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const DISCORD_MESSAGE_COMPONENT = 3;
const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;
const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._-]{20,500}$/;
const AVATAR_HASH_PATTERN = /^(?:a_)?[a-f0-9]{16,64}$/i;

export const GIVEAWAY_PARTICIPATION_INTERACTION_PREFIX = "gwstore_giveaway_join:";

export type GiveawayParticipationInput = {
  giveawayId: string;
  discordGuildId: string;
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type GiveawayParticipationResult = {
  wasCreated: boolean;
  validInviteCount: number;
};

export interface GiveawayParticipationRepository {
  register(input: GiveawayParticipationInput): Promise<GiveawayParticipationResult>;
}

export class GiveawayParticipationError extends Error {
  constructor(
    readonly reason: "closed" | "unauthorized" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "GiveawayParticipationError";
  }
}

export class SupabaseGiveawayParticipationRepository
implements GiveawayParticipationRepository {
  async register(
    input: GiveawayParticipationInput,
  ): Promise<GiveawayParticipationResult> {
    const client = createAdminSupabaseClient();
    if (!client) {
      throw new GiveawayParticipationError(
        "unavailable",
        "Supabase server-only não configurado.",
      );
    }

    const { data: giveaway, error: giveawayError } = await client
      .from("giveaways")
      .select("guild_id")
      .eq("id", input.giveawayId)
      .maybeSingle();
    if (giveawayError) {
      throw new GiveawayParticipationError("unavailable", giveawayError.message);
    }
    if (!giveaway) {
      throw new GiveawayParticipationError("closed", "Sorteio não encontrado.");
    }

    const { data: guild, error: guildError } = await client
      .from("guilds")
      .select("discord_guild_id")
      .eq("id", giveaway.guild_id)
      .maybeSingle();
    if (guildError) {
      throw new GiveawayParticipationError("unavailable", guildError.message);
    }
    if (!guild || guild.discord_guild_id !== input.discordGuildId) {
      throw new GiveawayParticipationError(
        "unauthorized",
        "A interação não pertence ao servidor deste sorteio.",
      );
    }

    const { data, error } = await client
      .rpc("register_giveaway_participant", {
        p_giveaway_id: input.giveawayId,
        p_discord_user_id: input.discordUserId,
        p_display_name: input.displayName,
        p_avatar_url: input.avatarUrl,
      })
      .single();
    if (error || !data) {
      if (error?.message.includes("not accepting") || error?.message.includes("not found")) {
        throw new GiveawayParticipationError(
          "closed",
          error.message,
        );
      }
      throw new GiveawayParticipationError(
        "unavailable",
        error?.message || "Não foi possível registrar a participação.",
      );
    }

    return {
      wasCreated: data.was_created,
      validInviteCount: data.valid_invite_count,
    };
  }
}

export function giveawayParticipationInteractionId(giveawayId: string) {
  if (!UUID_PATTERN.test(giveawayId)) {
    throw new Error("ID de sorteio inválido para o botão do Discord.");
  }
  return `${GIVEAWAY_PARTICIPATION_INTERACTION_PREFIX}${giveawayId.toLowerCase()}`;
}

export function parseNativeDiscordGiveawayParticipation(raw: unknown) {
  if (!isObject(raw) || raw.type !== DISCORD_MESSAGE_COMPONENT || !isObject(raw.data)) {
    return null;
  }
  const customId = typeof raw.data.custom_id === "string" ? raw.data.custom_id : "";
  if (!customId.startsWith(GIVEAWAY_PARTICIPATION_INTERACTION_PREFIX)) return null;
  const giveawayId = customId.slice(GIVEAWAY_PARTICIPATION_INTERACTION_PREFIX.length);
  if (!UUID_PATTERN.test(giveawayId)) return null;

  return {
    giveawayId: giveawayId.toLowerCase(),
    response: {
      type: DISCORD_DEFERRED_CHANNEL_MESSAGE,
      data: { flags: DISCORD_EPHEMERAL_FLAG },
    },
  } as const;
}

export async function completeDiscordGiveawayParticipation(
  raw: unknown,
  options: {
    repository?: GiveawayParticipationRepository;
    fetcher?: typeof fetch;
  } = {},
) {
  const parsed = parseNativeDiscordGiveawayParticipation(raw);
  if (!parsed) throw new Error("Interação de sorteio inválida.");
  const context = readDiscordInteraction(raw, "");
  const memberUser = isObject(raw) && isObject(raw.member) && isObject(raw.member.user)
    ? raw.member.user
    : null;
  if (
    !context.interactionId ||
    !context.guildId ||
    !context.userId ||
    memberUser?.id !== context.userId
  ) {
    throw new Error("Interação de sorteio sem contexto válido.");
  }

  const repository = options.repository ?? new SupabaseGiveawayParticipationRepository();
  const fetcher = options.fetcher ?? fetch;
  let status: "created" | "existing" | "closed" | "unavailable";
  let content: string;

  try {
    const result = await repository.register({
      giveawayId: parsed.giveawayId,
      discordGuildId: context.guildId,
      discordUserId: context.userId,
      displayName: discordDisplayName(raw, context.userId),
      avatarUrl: discordAvatarUrl(raw, context.userId),
    });
    status = result.wasCreated ? "created" : "existing";
    content = result.wasCreated
      ? "✅ Participação cadastrada com sucesso! Use **Visualizar** para acompanhar seu status."
      : "ℹ️ Você já está cadastrado neste sorteio. Use **Visualizar** para acompanhar seu status.";
  } catch (error) {
    if (error instanceof GiveawayParticipationError && error.reason === "closed") {
      status = "closed";
      content = "⏰ Este sorteio não está aceitando participações agora.";
    } else {
      status = "unavailable";
      content = "⚠️ Não foi possível cadastrar sua participação agora. Tente novamente em alguns instantes.";
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[discord-giveaway:participation] ${message}`);
    }
  }

  await updateDiscordOriginalInteraction(raw, content, fetcher);
  return { status };
}

function discordDisplayName(raw: unknown, discordUserId: string) {
  const user = discordInteractionUser(raw);
  const member = isObject(raw) && isObject(raw.member) ? raw.member : null;
  const candidates = [member?.nick, user?.global_name, user?.username];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 100);
    }
  }
  return `Usuário ${discordUserId.slice(-4)}`;
}

function discordAvatarUrl(raw: unknown, discordUserId: string) {
  const avatar = discordInteractionUser(raw)?.avatar;
  if (typeof avatar !== "string" || !AVATAR_HASH_PATTERN.test(avatar)) return null;
  const extension = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.${extension}?size=128`;
}

function discordInteractionUser(raw: unknown) {
  if (!isObject(raw)) return null;
  if (isObject(raw.member) && isObject(raw.member.user)) return raw.member.user;
  return isObject(raw.user) ? raw.user : null;
}

async function updateDiscordOriginalInteraction(
  raw: unknown,
  content: string,
  fetcher: typeof fetch,
) {
  if (!isObject(raw)) throw new Error("Interação Discord inválida.");
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim();
  const applicationId = typeof raw.application_id === "string" ? raw.application_id : "";
  const token = typeof raw.token === "string" ? raw.token : "";
  if (
    !configuredApplicationId ||
    applicationId !== configuredApplicationId ||
    !SNOWFLAKE_PATTERN.test(applicationId) ||
    !INTERACTION_TOKEN_PATTERN.test(token)
  ) {
    throw new Error("Interação Discord incompleta.");
  }

  const response = await fetcher(
    `${discordApiUrl()}/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        components: [],
        allowed_mentions: { parse: [] },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Discord recusou a confirmação privada (${response.status}).`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
