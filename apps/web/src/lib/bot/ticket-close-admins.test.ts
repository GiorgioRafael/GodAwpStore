import { describe, expect, it } from "vitest";

import {
  DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
  MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
  normalizeTicketCloseAdminDiscordUserIds,
} from "./ticket-close-admins";
import { ticketCloseAdminDiscordUserIdsSchema } from "./ticket-close-admins-validation";

describe("Discord ticket close admins", () => {
  it("uses the three required defaults only when persisted settings are missing", () => {
    expect(normalizeTicketCloseAdminDiscordUserIds(undefined)).toEqual(
      DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
    );
    expect(normalizeTicketCloseAdminDiscordUserIds(null)).toEqual(
      DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
    );
    expect(normalizeTicketCloseAdminDiscordUserIds([])).toEqual([]);
  });

  it("trims, filters and deduplicates IDs in stable order", () => {
    expect(
      normalizeTicketCloseAdminDiscordUserIds([
        " 234486394414825472 ",
        "invalid",
        "385924725332901909",
        "234486394414825472",
      ]),
    ).toEqual(["234486394414825472", "385924725332901909"]);
  });

  it("caps defensive normalization at the configured limit", () => {
    const ids = Array.from(
      { length: MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS + 2 },
      (_, index) => `4${String(index).padStart(17, "0")}`,
    );
    expect(normalizeTicketCloseAdminDiscordUserIds(ids)).toEqual(
      ids.slice(0, MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS),
    );
  });

  it("validates snowflakes, duplicates and the maximum length strictly", () => {
    expect(
      ticketCloseAdminDiscordUserIdsSchema.parse([
        " 234486394414825472 ",
        "385924725332901909",
      ]),
    ).toEqual(["234486394414825472", "385924725332901909"]);
    expect(
      ticketCloseAdminDiscordUserIdsSchema.safeParse([
        "234486394414825472",
        "234486394414825472",
      ]).success,
    ).toBe(false);
    expect(ticketCloseAdminDiscordUserIdsSchema.safeParse(["invalid"]).success).toBe(false);

    const tooMany = Array.from(
      { length: MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS + 1 },
      (_, index) => `5${String(index).padStart(17, "0")}`,
    );
    expect(ticketCloseAdminDiscordUserIdsSchema.safeParse(tooMany).success).toBe(false);
  });
});
