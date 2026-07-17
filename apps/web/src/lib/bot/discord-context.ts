import type { DiscordGuildIdentity } from "./types";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

type DiscordInteractionPayload = {
  id?: unknown;
  guild_id?: unknown;
  member?: { user?: { id?: unknown }; premium_since?: unknown };
  user?: { id?: unknown };
};

export function readDiscordInteraction(raw: unknown, normalizedUserId: string) {
  const interaction = isObject(raw) ? (raw as DiscordInteractionPayload) : null;
  const interactionId = asSnowflake(interaction?.id);
  const guildId = asSnowflake(interaction?.guild_id);
  const rawUserId = asSnowflake(interaction?.member?.user?.id) ?? asSnowflake(interaction?.user?.id);
  const userId = asSnowflake(normalizedUserId) ?? rawUserId;
  const isServerBooster = isIsoDateTime(interaction?.member?.premium_since);

  return { interactionId, guildId, userId, isServerBooster };
}

export async function fetchDiscordGuildIdentity(
  guildId: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordGuildIdentity> {
  if (!SNOWFLAKE_PATTERN.test(guildId)) {
    throw new Error("Discord guild ID inválido.");
  }

  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN não configurado.");
  }

  const apiUrl = (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(/\/$/, "");
  const response = await fetcher(`${apiUrl}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Discord recusou a leitura do servidor (${response.status}).`);
  }

  const body: unknown = await response.json();
  if (!isObject(body)) {
    throw new Error("Resposta inválida do Discord.");
  }

  const id = asSnowflake(body.id);
  const ownerDiscordId = asSnowflake(body.owner_id);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (id !== guildId || !ownerDiscordId || !name) {
    throw new Error("Dados incompletos do servidor Discord.");
  }

  return { discordGuildId: id, ownerDiscordId, name };
}

function asSnowflake(value: unknown) {
  return typeof value === "string" && SNOWFLAKE_PATTERN.test(value) ? value : null;
}

function isIsoDateTime(value: unknown) {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
