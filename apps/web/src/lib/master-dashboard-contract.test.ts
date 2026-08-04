import { describe, expect, it } from "vitest";

import { serviceDashboardSnapshotSchema } from "@/lib/master-dashboard-contract";

describe("serviceDashboardSnapshotSchema", () => {
  it("accepts ISO timestamps returned by Postgres with an explicit UTC offset", () => {
    const result = serviceDashboardSnapshotSchema.safeParse({
      version: 1,
      generatedAt: "2026-08-04T17:46:08.699Z",
      service: {
        id: "thstore",
        name: "Loja TH",
        adminPanelUrl: "https://thstoreadm.vercel.app",
      },
      monthlyRevenue: [],
      bots: [
        {
          guildId: "6b272381-d0c0-46bd-83da-71061770549f",
          discordGuildId: "1319006069611302932",
          guildName: "Loja TH",
          ownerDiscordId: "949355341353721868",
          status: "active",
          lastSeenAt: null,
          lastPaidAt: "2026-08-04T04:00:27.207318+00:00",
          currentMonthRevenueCents: 18_696,
          previousMonthRevenueCents: 18_288,
          currentMonthPaidOrdersCount: 39,
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
