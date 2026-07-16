import type { User } from "@supabase/supabase-js";

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;

export type AdminIdentity = {
  authUserId: string;
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
};

export function parseAdminDiscordIds(raw = process.env.ADMIN_DISCORD_IDS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => DISCORD_SNOWFLAKE.test(value)),
  );
}

function identityValue(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractDiscordIdentity(user: User): AdminIdentity | null {
  const discordIdentity = user.identities?.find((identity) => identity.provider === "discord");
  const identityData = discordIdentity?.identity_data;
  if (!identityData) return null;

  const discordId = identityValue(identityData, ["provider_id", "sub", "id"]);

  if (!discordId || !DISCORD_SNOWFLAKE.test(discordId)) {
    return null;
  }

  const displayName =
    identityValue(identityData, ["full_name", "global_name", "preferred_username", "name", "user_name"]) ??
    `Discord ${discordId}`;
  const avatarUrl = identityValue(identityData, ["avatar_url", "picture"]);

  return {
    authUserId: user.id,
    discordId,
    displayName,
    avatarUrl,
  };
}
