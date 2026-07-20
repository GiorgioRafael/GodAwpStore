import "server-only";

import { discordApiUrl } from "@/lib/bot/discord-api";

const SNOWFLAKE_EPOCH_MS = 1_420_070_400_000n;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export type DiscordOAuthUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
};

export async function fetchDiscordOAuthUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordOAuthUser> {
  const response = await fetcher(`${discordApiUrl()}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !isObject(payload) ||
    typeof payload.id !== "string" ||
    !SNOWFLAKE_PATTERN.test(payload.id) ||
    typeof payload.username !== "string" ||
    payload.username.trim() === ""
  ) {
    throw new Error("Discord retornou um usuário inválido.");
  }
  return {
    id: payload.id,
    username: payload.username,
    globalName: typeof payload.global_name === "string" ? payload.global_name : null,
    avatar: typeof payload.avatar === "string" ? payload.avatar : null,
  };
}

export function discordAccountCreatedAt(discordUserId: string) {
  if (!SNOWFLAKE_PATTERN.test(discordUserId)) throw new Error("ID Discord inválido.");
  const timestamp = (BigInt(discordUserId) >> 22n) + SNOWFLAKE_EPOCH_MS;
  return new Date(Number(timestamp));
}

export function discordDisplayName(user: DiscordOAuthUser) {
  return (user.globalName || user.username).trim().slice(0, 100);
}

export function discordAvatarUrl(user: DiscordOAuthUser) {
  if (!user.avatar) return null;
  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
