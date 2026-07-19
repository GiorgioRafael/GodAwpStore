import { DISCORD_USER_ID_PATTERN } from "./ticket-notifications";

export const DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS = [
  "234486394414825472",
  "385924725332901909",
  "911402638975844354",
] as const;

export const MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS = 25;

export function normalizeTicketCloseAdminDiscordUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const userId = candidate.trim();
    if (!DISCORD_USER_ID_PATTERN.test(userId) || seen.has(userId)) continue;

    seen.add(userId);
    normalized.push(userId);
    if (normalized.length === MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS) break;
  }

  return normalized;
}
