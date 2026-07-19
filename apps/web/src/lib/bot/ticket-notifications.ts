export const DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS = [
  "385924725332901909",
] as const;

export const MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS = 25;

export const DISCORD_USER_ID_PATTERN = /^[0-9]{15,22}$/;

/**
 * Normalizes persisted configuration defensively at runtime.
 *
 * A missing/non-array value means the setting has not been created yet, so
 * the required default is used. An explicitly saved empty array remains empty.
 */
export function normalizeTicketNotificationDiscordUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const userId = candidate.trim();
    if (!DISCORD_USER_ID_PATTERN.test(userId) || seen.has(userId)) continue;

    seen.add(userId);
    normalized.push(userId);
    if (normalized.length === MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS) break;
  }

  return normalized;
}
