import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bot/message-customization-server", () => ({
  loadBotRuntimeSettings: vi.fn().mockResolvedValue({
    customization: {},
    ticketNotificationDiscordUserIds: [],
    ticketCloseAdminDiscordUserIds: [],
  }),
}));

import {
  ensureGiveawayWinnerTicket,
  giveawayAnnouncementPayload,
  giveawayWinnerTicketPayload,
  publishGiveawayAnnouncement,
  type GiveawayAnnouncementInput,
} from "./discord";

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

afterEach(() => {
  vi.unstubAllEnvs();
});

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
      style: 3,
      custom_id: "gwstore_giveaway_join:11111111-1111-4111-8111-111111111111",
    });
    expect(payload.components[0]?.components[1]).toMatchObject({
      label: "Visualizar",
      style: 5,
      url: "https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar",
    });
    expect(payload.allowed_mentions).toEqual({ parse: [], users: [] });
  });

  it("mantém os dois botões disponíveis enquanto a publicação ainda está agendada", () => {
    const payload = giveawayAnnouncementPayload(
      { ...input, status: "scheduled" },
      "https://gwstore.vercel.app",
    );

    expect(payload.components[0]?.components).toHaveLength(2);
    expect(payload.components[0]?.components.map((component) => component.label)).toEqual([
      "Participar",
      "Visualizar",
    ]);
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

  it("mantém os embeds dentro dos limites com 20 itens e textos máximos", () => {
    const largeInput = {
      ...input,
      description: "D".repeat(2_000),
      rulesText: "R".repeat(2_000),
      prizes: Array.from({ length: 20 }, (_, index) => ({
        productName: `${index}-${"Produto muito longo ".repeat(20)}`,
        quantity: 10_000,
      })),
    };
    const announcement = giveawayAnnouncementPayload(
      largeInput,
      "https://gwstore.vercel.app",
    );
    const ticket = giveawayWinnerTicketPayload(
      {
        giveawayId: input.id,
        guildId: "123456789012345678",
        winnerDiscordUserId: "223456789012345678",
        winnerDisplayName: "Ganhador",
        title: input.title,
        prizes: largeInput.prizes,
      },
      [],
    );

    expect(announcement.embeds[0].description.length).toBeLessThanOrEqual(4_096);
    expect(announcement.embeds[0].fields.every((field) => field.value.length <= 1_024)).toBe(true);
    expect(ticket.embeds[0].fields.every((field) => field.value.length <= 1_024)).toBe(true);
    expect(ticket.embeds[0].fields.length).toBeLessThanOrEqual(25);
  });

  it("recria uma publicação apagada quando o PATCH retorna Unknown Message", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 10_008 }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "323456789012345678",
        channel_id: input.channelId,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    await expect(publishGiveawayAnnouncement(
      { ...input, messageId: "423456789012345678" },
      { fetcher, siteUrl: "https://gwstore.vercel.app" },
    )).resolves.toEqual({ messageId: "323456789012345678" });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("não duplica a mensagem do ganhador quando ela já existe no ticket", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    vi.stubEnv("DISCORD_APPLICATION_ID", "523456789012345678");
    const giveawayId = input.id;
    const channelId = "623456789012345678";
    const requests: Array<{ url: string; method: string }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      requests.push({ url: href, method });
      const json = (value: unknown) => new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      if (href.endsWith("/users/@me")) {
        return json({ id: "523456789012345678", bot: true });
      }
      if (href.endsWith("/guilds/123456789012345678")) {
        return json({ id: "123456789012345678" });
      }
      if (href.endsWith("/guilds/123456789012345678/channels")) {
        return json([{ id: channelId, type: 0, topic: `gwstore:giveaway:${giveawayId}` }]);
      }
      if (href.includes(`/channels/${channelId}/messages?limit=100`)) {
        return json([{ author: { id: "523456789012345678" }, embeds: [{
          footer: { text: `GWStore Giveaway • ${giveawayId}` },
        }] }]);
      }
      if (href.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        return json({ id: channelId, type: 0, topic: body.topic ?? `gwstore:giveaway:${giveawayId}`, permission_overwrites: body.permission_overwrites });
      }
      throw new Error(`Requisição inesperada: ${method} ${href}`);
    });

    await expect(ensureGiveawayWinnerTicket({
      giveawayId,
      guildId: "123456789012345678",
      winnerDiscordUserId: "223456789012345678",
      winnerDisplayName: "Ganhador",
      title: input.title,
      prizes: input.prizes,
    }, { fetcher })).resolves.toEqual({ channelId, created: false });

    expect(requests.some((request) =>
      request.url.endsWith(`/channels/${channelId}/messages`) && request.method === "POST",
    )).toBe(false);
  });
});
