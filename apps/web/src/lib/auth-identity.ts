import type { User } from "@supabase/supabase-js";

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const REQUIRED_ADMIN_DISCORD_IDS = ["234486394414825472"] as const;
const DEFAULT_MASTER_ADMIN_GOOGLE_EMAILS = [
  "jukersrx@gmail.com",
  "henriquejoao074@gmail.com",
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AdminIdentity = {
  authUserId: string;
  discordId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type MasterAdminIdentity = {
  authUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export function parseAdminDiscordIds(raw = process.env.ADMIN_DISCORD_IDS): Set<string> {
  const configuredIds = new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => DISCORD_SNOWFLAKE.test(value)),
  );

  for (const discordId of REQUIRED_ADMIN_DISCORD_IDS) {
    configuredIds.add(discordId);
  }

  return configuredIds;
}

export function parseMasterAdminGoogleEmails(
  raw = process.env.MASTER_ADMIN_GOOGLE_EMAILS,
): Set<string> {
  const source = raw == null ? DEFAULT_MASTER_ADMIN_GOOGLE_EMAILS.join(",") : raw;
  return new Set(
    source
      .split(",")
      .map((value) => value.trim().toLocaleLowerCase("en-US"))
      .filter((value) => EMAIL.test(value)),
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

export function extractGoogleIdentity(user: User): MasterAdminIdentity | null {
  const googleIdentity = user.identities?.find((identity) => identity.provider === "google");
  const identityData = googleIdentity?.identity_data;
  if (!identityData) return null;

  const email = identityValue(identityData, ["email"])?.toLocaleLowerCase("en-US");
  const emailVerified =
    identityData.email_verified === true || identityData.verified_email === true;
  if (!email || !EMAIL.test(email) || !emailVerified) return null;

  const displayName =
    identityValue(identityData, ["full_name", "name", "given_name"]) ?? email;
  const avatarUrl = identityValue(identityData, ["avatar_url", "picture"]);

  return {
    authUserId: user.id,
    email,
    displayName,
    avatarUrl,
  };
}
