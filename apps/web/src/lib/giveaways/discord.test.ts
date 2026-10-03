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
  giveawayRerollAnnouncementPayload,
  giveawayResultAnnouncementPayload,
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
  winnerCount: 1,
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

    expect(payload.embeds[0].title).toBe("🎁 PRÊMIO: Pacote especial");
    expect(description).toContain("ITENS DO SORTEIO");
    expect(description).toContain("2× Super Watering");
    expect(description).toContain("1× Dragon's Breath");
    expect(description).toContain("2 convite(s) nativo(s) válido(s)");
    expect(description).toContain("7 dia(s)");
    expect(description).toContain("1 hora(s)");
    expect(description).toContain("Crie um convite do servidor pelo próprio Discord");
    expect(description).toContain("O bot reconhecerá o criador do convite");
    expect(payload.components[0]?.components[0]).toMatchObject({
      label: "Participar",
      style: 3,
      custom_id: "gwstore_giveaway_join:11111111-1111-4111-8111-111111111111",
    });
    expect(payload.components[0]?.components[1]).toMatchObject({
      label: "Consultar status",
      style: 5,
      url: "https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar",
    });
    expect(payload.embeds[0].fields.at(-1)).toMatchObject({
      name: "Observações adicionais",
    });
    expect(payload.embeds[0].fields.at(-1)?.value).toContain(
      "Os requisitos automáticos acima são os únicos usados pelo sistema",
    );
    expect(payload.allowed_mentions).toEqual({ parse: [], users: [] });
  });

  it("destaca o prêmio e explica a divisão antes de um sorteio com cinco ganhadores", () => {
    const payload = giveawayAnnouncementPayload(
      {
        ...input,
        winnerCount: 5,
        prizes: [{ productName: "Star Fruit", quantity: 12 }],
      },
      "https://gwstore.vercel.app",
    );

    expect(payload.embeds[0].title).toContain("PRÊMIO");
    expect(payload.embeds[0].description).toContain("12× Star Fruit");
    expect(payload.embeds[0].description).toContain("5 ganhadores");
    expect(payload.embeds[0].description).toContain(
      "unidades restantes são distribuídas seguindo a ordem do sorteio",
    );
  });

  it("mantém os dois botões disponíveis enquanto a publicação ainda está agendada", () => {
    const payload = giveawayAnnouncementPayload(
      { ...input, status: "scheduled" },
      "https://gwstore.vercel.app",
    );

    expect(payload.components[0]?.components).toHaveLength(2);
    expect(payload.components[0]?.components.map((component) => component.label)).toEqual([
      "Participar",
      "Consultar status",
    ]);
  });

  it("simplifica a participação quando não há indicação obrigatória", () => {
    const payload = giveawayAnnouncementPayload(
      { ...input, requiredValidInvites: 0 },
      "https://gwstore.vercel.app",
    );

    expect(payload.embeds[0].description).toContain("Sem indicação obrigatória");
    expect(payload.embeds[0].description).not.toContain(
      "Convites comuns criados diretamente no Discord não são contabilizados",
    );
    expect(payload.embeds[0].description).not.toContain("Conta Discord com");
    expect(payload.embeds[0].description).not.toContain("Permanecer 1 hora");
    expect(payload.components[0]?.components[0].label).toBe("Participar");
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

  it("anuncia vários ganhadores e permite mencionar somente os sorteados", () => {
    const winners = [
      { discordUserId: "223456789012345678", displayName: "Primeiro" },
      { discordUserId: "323456789012345678", displayName: "Segundo" },
    ];
    const payload = giveawayAnnouncementPayload(
      { ...input, status: "completed", winners },
      "https://gwstore.vercel.app",
    );

    expect(payload.components).toEqual([]);
    expect(payload.embeds[0].description).toContain("2 ganhadores");
    expect(payload.embeds[0].description).toContain("1. <@223456789012345678>");
    expect(payload.embeds[0].description).toContain("2. <@323456789012345678>");
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: winners.map((winner) => winner.discordUserId),
    });
  });

  it("cria uma mensagem de resultado separada no canal do sorteio", () => {
    const winners = [
      { discordUserId: "223456789012345678", displayName: "Primeiro" },
      { discordUserId: "323456789012345678", displayName: "Segundo" },
    ];
    const payload = giveawayResultAnnouncementPayload(
      {
        ...input,
        status: "completed",
        winnerCount: 2,
        winners,
        prizes: [{ productName: "Star Fruit", quantity: 5 }],
      },
      "https://gwstore.vercel.app",
    );

    expect(payload.content).toContain("Sorteio encerrado");
    expect(payload.content).toContain("@everyone");
    expect(payload.allowed_mentions).toEqual({
      parse: ["everyone"],
      users: winners.map((winner) => winner.discordUserId),
    });
    expect(payload.embeds[0].title).toBe("🏆 RESULTADO DO SORTEIO");
    expect(payload.embeds[0].description).toContain("1.** <@223456789012345678>");
    expect(payload.embeds[0].description).toContain("2.** <@323456789012345678>");
    expect(payload.embeds[0].description).toContain("3×** Star Fruit");
    expect(payload.embeds[0].description).toContain("2×** Star Fruit");
    expect(payload.components[0].components[0]).toMatchObject({
      label: "Ver resultado",
      url: "https://gwstore.vercel.app/api/sorteios/oauth/iniciar?slug=abc123def456&modo=visualizar",
    });
  });

  it("anuncia um resorteio em uma nova mensagem e marca todos", () => {
    const winners = [
      { discordUserId: "223456789012345678", displayName: "Primeiro" },
      { discordUserId: "323456789012345678", displayName: "Segundo" },
    ];
    const payload = giveawayRerollAnnouncementPayload(
      { ...input, status: "completed", winners },
      "https://gwstore.vercel.app",
    );

    expect(payload.content).toContain("@everyone");
    expect(payload.content).toContain("Ganhadores atualizados");
    expect(payload.allowed_mentions).toEqual({
      parse: ["everyone"],
      users: winners.map((winner) => winner.discordUserId),
    });
    expect(payload.embeds[0].title).toBe("🔄 NOVO RESULTADO DO SORTEIO");
    expect(payload.embeds[0].description).toContain("<@223456789012345678>");
    expect(payload.embeds[0].description).toContain("<@323456789012345678>");
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

  it.each([
    ["1401264061101899820", false], ["1401264061101899820", true],
    ["123456789012345678", false], ["123456789012345678", true],
  ] as const)("encaminha prêmio para Compra somente na GW (%s, recuperado=%s)", async (guildId, existing) => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    const botId = "523456789012345678";
    vi.stubEnv("DISCORD_APPLICATION_ID", botId);
    const categoryId = "823456789012345678";
    const legacyCategoryId = "923456789012345678";
    const winnerId = "223456789012345678";
    const channelId = "623456789012345678";
    const { buildTicketPermissionOverwrites } = await import("@/lib/bot/discord-ticket-controls");
    const permissions = buildTicketPermissionOverwrites({ guildId, buyerDiscordId: winnerId, botDiscordId: botId });
    let channel: { id: string; type: number; topic: string; parent_id: string; permission_overwrites: typeof permissions } | null = existing
      ? { id: channelId, type: 0, topic: `gwstore:giveaway:${input.id};welcome=1`,
        parent_id: legacyCategoryId, permission_overwrites: permissions } : null;
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/users/@me")) return Response.json({ id: botId, bot: true });
      if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ id: guildId });
      if (url.endsWith(`/guilds/${guildId}/channels`) && method === "GET") {
        return Response.json([{ id: categoryId, type: 4, name: "🛒┊COMPRA" }, ...(channel ? [channel] : [])]);
      }
      if (url.endsWith(`/guilds/${guildId}/channels`) && method === "POST") {
        channel = { id: channelId, ...body };
        return Response.json(channel);
      }
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel!, ...body };
        return Response.json(channel);
      }
      if (url.includes(`/channels/${channelId}/messages?`)) return Response.json([]);
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") return Response.json({ id: "723456789012345678" });
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;

    await expect(ensureGiveawayWinnerTicket({ giveawayId: input.id, guildId,
      winnerDiscordUserId: winnerId, winnerDisplayName: "Ganhador", title: input.title,
      prizes: input.prizes, parentChannelId: legacyCategoryId }, { fetcher }))
      .resolves.toEqual({ channelId, created: !existing });
    const creates = calls.filter(call => call.method === "POST" && call.url.endsWith(`/guilds/${guildId}/channels`));
    expect(creates).toHaveLength(existing ? 0 : 1);
    const isGw = guildId === "1401264061101899820";
    if (!existing) expect(creates[0]?.body).toMatchObject({ parent_id: isGw ? categoryId : legacyCategoryId, permission_overwrites: permissions });
    const moves = calls.filter(call => call.method === "PATCH" && call.body?.parent_id);
    expect(moves.map(call => call.body)).toEqual(existing && isGw ? [{ parent_id: categoryId }] : []);
    expect(channel?.permission_overwrites).toEqual(permissions);
    expect(channel?.parent_id).toBe(isGw ? categoryId : legacyCategoryId);
  });
});
