import "server-only";

import { assertDiscordBotGuildAccess, discordBotRequest } from "@/lib/bot/discord-api";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export type DiscordGuildMembership = {
  exists: boolean;
  pending: boolean;
  joinedAt: string | null;
};

export async function getDiscordGuildMembership(
  guildId: string,
  userId: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordGuildMembership> {
  assertIds(guildId, userId);
  const response = await discordBotRequest(
    `/guilds/${guildId}/members/${userId}`,
    {},
    fetcher,
  );
  if (response.status === 404) {
    await assertDiscordBotGuildAccess(guildId, fetcher);
    return { exists: false, pending: false, joinedAt: null };
  }
  if (!response.ok) {
    throw new Error(`Discord recusou a validação do membro (${response.status}).`);
  }
  return normalizeMember(await response.json());
}

export async function addDiscordGuildMember(
  guildId: string,
  userId: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordGuildMembership & { alreadyMember: boolean }> {
  assertIds(guildId, userId);
  const response = await discordBotRequest(
    `/guilds/${guildId}/members/${userId}`,
    {
      method: "PUT",
      body: JSON.stringify({ access_token: accessToken }),
    },
    fetcher,
  );
  if (response.status === 204) {
    return { exists: true, pending: false, joinedAt: null, alreadyMember: true };
  }
  if (!response.ok) {
    throw new Error(`Discord recusou a entrada no servidor (${response.status}).`);
  }
  return { ...normalizeMember(await response.json()), alreadyMember: false };
}

function normalizeMember(value: unknown): DiscordGuildMembership {
  if (typeof value !== "object" || value === null) {
    throw new Error("Discord retornou um membro inválido.");
  }
  const member = value as { pending?: unknown; joined_at?: unknown };
  const joinedAt = typeof member.joined_at === "string" && !Number.isNaN(Date.parse(member.joined_at))
    ? member.joined_at
    : null;
  return {
    exists: true,
    pending: member.pending === true,
    joinedAt,
  };
}

function assertIds(guildId: string, userId: string) {
  if (!SNOWFLAKE_PATTERN.test(guildId) || !SNOWFLAKE_PATTERN.test(userId)) {
    throw new Error("Servidor ou usuário Discord inválido.");
  }
}
