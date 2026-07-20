import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { giveawayAnnouncementPayload, type GiveawayAnnouncementInput } from "./discord";

const input: GiveawayAnnouncementInput = {
  id: "11111111-1111-4111-8111-111111111111",
  publicSlug: "abc123def456",
  channelId: "123456789012345678",
  title: "Pacote especial",
  description: "Um único ganhador leva tudo.",
  rulesText: "Sem contas alternativas.",
  startsAt: "2026-07-20T18:00:00.000Z",
  endsAt: "2026-07-21T18:00:00.000Z",
  status: "active",
  requiredValidInvites: 2,
  minimumAccountAgeDays: 7,
  minimumStayMinutes: 60,
  prizes: [
    { productName: "Super Watering", quantity: 2 },
    { productName: "Dragon's Breath", quantity: 1 },
  ],
};

describe("giveaway Discord announcement", () => {
  it("publica o pacote completo, os critérios e o domínio canônico", () => {
    const payload = giveawayAnnouncementPayload(input, "https://gwstore.vercel.app");
    const description = payload.embeds[0].description;

    expect(description).toContain("2×** Super Watering");
    expect(description).toContain("1×** Dragon's Breath");
    expect(description).toContain("2 convite(s) válido(s)");
    expect(description).toContain("7 dia(s)");
    expect(description).toContain("1 hora(s)");
    expect(payload.components[0]?.components[0]).toMatchObject({
      label: "Participar",
      url: "https://gwstore.vercel.app/sorteios/abc123def456",
    });
    expect(payload.allowed_mentions).toEqual({ parse: [], users: [] });
  });

  it("remove o botão ao concluir e menciona somente o ganhador", () => {
    const payload = giveawayAnnouncementPayload(
      { ...input, status: "completed", winnerDiscordUserId: "223456789012345678" },
      "https://gwstore.vercel.app",
    );

    expect(payload.components).toEqual([]);
    expect(payload.embeds[0].description).toContain("<@223456789012345678>");
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: ["223456789012345678"],
    });
  });
});
