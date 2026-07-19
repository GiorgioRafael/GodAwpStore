import { describe, expect, it } from "vitest";

import {
  DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
  MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS,
  normalizeTicketNotificationDiscordUserIds,
} from "./ticket-notifications";
import { ticketNotificationDiscordUserIdsSchema } from "./ticket-notifications-validation";

describe("Discord ticket notifications", () => {
  it("uses the required default only when the persisted setting is missing", () => {
    expect(normalizeTicketNotificationDiscordUserIds(undefined)).toEqual(
      DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
    );
    expect(normalizeTicketNotificationDiscordUserIds(null)).toEqual(
      DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
    );
    expect(normalizeTicketNotificationDiscordUserIds("invalid")).toEqual(
      DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS,
    );
    expect(normalizeTicketNotificationDiscordUserIds([])).toEqual([]);
  });

  it("trims, filters and deduplicates configured Discord IDs in stable order", () => {
    expect(
      normalizeTicketNotificationDiscordUserIds([
        " 385924725332901909 ",
        "invalid",
        385924725332901909,
        "911402638975844354",
        "385924725332901909",
      ]),
    ).toEqual(["385924725332901909", "911402638975844354"]);
  });

  it("caps defensive runtime normalization at the safe notification limit", () => {
    const userIds = Array.from(
      { length: MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS + 2 },
      (_, index) => `1000000000000${String(index).padStart(2, "0")}`,
    );

    expect(normalizeTicketNotificationDiscordUserIds(userIds)).toEqual(
      userIds.slice(0, MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS),
    );
  });

  it("exports strict Zod validation for the admin action", () => {
    expect(
      ticketNotificationDiscordUserIdsSchema.parse([
        "385924725332901909",
        " 911402638975844354 ",
      ]),
    ).toEqual(["385924725332901909", "911402638975844354"]);
    expect(
      ticketNotificationDiscordUserIdsSchema.safeParse([
        "385924725332901909",
        "385924725332901909",
      ]).success,
    ).toBe(false);
    expect(ticketNotificationDiscordUserIdsSchema.safeParse(["not-a-user"]).success).toBe(false);

    const tooMany = Array.from(
      { length: MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS + 1 },
      (_, index) => `2000000000000${String(index).padStart(2, "0")}`,
    );
    expect(ticketNotificationDiscordUserIdsSchema.safeParse(tooMany).success).toBe(false);
  });
});
