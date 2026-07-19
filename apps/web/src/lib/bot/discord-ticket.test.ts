import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./message-customization-server", async () => {
  const { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } = await import("./message-customization");
  const { DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS } = await import(
    "./ticket-notifications"
  );
  const { DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS } = await import(
    "./ticket-close-admins"
  );
  return {
    loadBotMessageCustomization: vi.fn(async () => DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
    loadBotRuntimeSettings: vi.fn(async () => ({
      customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticketNotificationDiscordUserIds: [...DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS],
      ticketCloseAdminDiscordUserIds: [...DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS],
    })),
  };
});

type TicketModule = typeof import("./discord-ticket");
let ticket: TicketModule;

const order = {
  orderId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  guildId: "123456789012345678",
  buyerDiscordId: "223456789012345678",
  productName: "Dragon Breath @everyone\n",
  quantity: 2,
  paidAmountCents: 200,
};
const botId = "323456789012345678";
const channelId = "623456789012345678";
const defaultNotificationUserId = "385924725332901909";
const defaultCloseAdminUserIds = [
  "234486394414825472",
  "385924725332901909",
  "911402638975844354",
];

beforeAll(async () => {
  ticket = await import("./discord-ticket");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Discord paid-order ticket", () => {
  it("nega @everyone e libera somente comprador e bot; administradores ignoram overwrites", () => {
    const overwrites = ticket.buildTicketPermissionOverwrites({
      guildId: order.guildId,
      buyerDiscordId: order.buyerDiscordId,
      botDiscordId: botId,
    });

    expect(overwrites).toEqual([
      { id: order.guildId, type: 0, allow: "0", deny: "1024" },
      { id: order.buyerDiscordId, type: 1, allow: "84992", deny: "0" },
      { id: botId, type: 1, allow: "84992", deny: "0" },
    ]);
  });

  it("cria canal privado e mensagem segura após confirmação", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "secret-ticket-token");
    const requests: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
    let channel = channelResponse(`gwstore-order:${order.orderId}`, []);
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const headers = new Headers(init?.headers);
      requests.push({ url, method, body, headers });

      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "GET") return Response.json([]);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "POST") {
        channel = channelResponse(body.topic, body.permission_overwrites);
        return Response.json(channel, { status: 201 });
      }
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") {
        return Response.json({ id: "723456789012345678", author: { id: botId }, embeds: body.embeds });
      }
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;

    await expect(ticket.ensurePaidOrderTicket(order, { fetcher })).resolves.toEqual({
      channelId,
      channelName: "ticket-9a845b407c4e",
      created: true,
      welcomeMessageCreated: true,
      permissionsRepaired: false,
    });

    const createChannel = requests.find(
      (request) => request.method === "POST" && request.url.endsWith(`/guilds/${order.guildId}/channels`),
    );
    expect(createChannel?.headers.get("authorization")).toBe("Bot secret-ticket-token");
    expect(createChannel?.body).toMatchObject({
      name: "ticket-9a845b407c4e",
      type: 0,
      topic: `gwstore-order:${order.orderId}`,
      permission_overwrites: expect.arrayContaining([
        { id: order.guildId, type: 0, allow: "0", deny: "1024" },
        { id: order.buyerDiscordId, type: 1, allow: "84992", deny: "0" },
        { id: botId, type: 1, allow: "84992", deny: "0" },
        ...defaultCloseAdminUserIds.map((id) => ({
          id,
          type: 1,
          allow: "84992",
          deny: "0",
        })),
      ]),
    });

    const welcome = requests.find(
      (request) => request.method === "POST" && request.url.endsWith(`/channels/${channelId}/messages`),
    );
    expect(welcome?.body).toMatchObject({
      content: expect.stringContaining(`<@${order.buyerDiscordId}>`),
      allowed_mentions: {
        parse: [],
        users: [order.buyerDiscordId, defaultNotificationUserId],
        replied_user: false,
      },
      enforce_nonce: true,
      embeds: [
        expect.objectContaining({
          title: "Pagamento confirmado",
          footer: { text: `GWStore ticket · ${order.orderId}` },
        }),
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              custom_id: `gwstore_game_nickname:${order.orderId}`,
            },
            {
              type: 2,
              style: 4,
              custom_id: `gwstore_ticket_close:${order.orderId}`,
            },
          ],
        },
      ],
    });
    expect((welcome?.body as { content: string }).content).toContain(
      `Equipe notificada: <@${defaultNotificationUserId}>`,
    );
    expect((welcome?.body as { content: string }).content).toContain("nick");
    expect(String((welcome?.body as { nonce: string }).nonce)).toHaveLength(25);
    expect(JSON.stringify(welcome?.body)).toContain("Dragon Breath @everyone");
    expect(JSON.stringify(welcome?.body)).not.toContain("secret-ticket-token");
  });

  it("allowlists multiple configured users and deduplicates the buyer", () => {
    const secondNotificationUserId = "911402638975844354";
    const payload = ticket.paidTicketWelcomeMessage(order, undefined, [
      defaultNotificationUserId,
      order.buyerDiscordId,
      secondNotificationUserId,
      defaultNotificationUserId,
      "@everyone",
    ]);

    expect(payload.content).toContain(
      `Equipe notificada: <@${defaultNotificationUserId}> <@${secondNotificationUserId}>`,
    );
    expect(payload.content.match(new RegExp(`<@${order.buyerDiscordId}>`, "g"))).toHaveLength(1);
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: [order.buyerDiscordId, defaultNotificationUserId, secondNotificationUserId],
      replied_user: false,
    });
    expect(payload.content).not.toContain("@everyone");
  });

  it("supports an explicitly empty notification list without broad mentions", () => {
    const payload = ticket.paidTicketWelcomeMessage(order, undefined, []);

    expect(payload.content).not.toContain("Equipe notificada:");
    expect(payload.allowed_mentions).toEqual({
      parse: [],
      users: [order.buyerDiscordId],
      replied_user: false,
    });
  });

  it("colapsa concorrência e reutiliza o mesmo ticket sem duplicar mensagem", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    let channel: ReturnType<typeof channelResponse> | null = null;
    let channelCreates = 0;
    let messageCreates = 0;

    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "GET") {
        return Response.json(channel ? [channel] : []);
      }
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "POST") {
        channelCreates += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        channel = channelResponse(body.topic, body.permission_overwrites);
        return Response.json(channel, { status: 201 });
      }
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") {
        messageCreates += 1;
        return Response.json({ id: "723456789012345678", author: { id: botId }, embeds: body.embeds });
      }
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel!, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;

    const [first, concurrent] = await Promise.all([
      ticket.ensurePaidOrderTicket(order, { fetcher }),
      ticket.ensurePaidOrderTicket(order, { fetcher }),
    ]);
    const retry = await ticket.ensurePaidOrderTicket(order, { fetcher });

    expect(first).toEqual(concurrent);
    expect(retry).toMatchObject({ created: false, welcomeMessageCreated: false });
    expect(channelCreates).toBe(1);
    expect(messageCreates).toBe(1);
  });

  it("repara um ticket existente com permissões abertas antes de reutilizá-lo", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    let channel = channelResponse(`gwstore-order:${order.orderId};welcome=1`, []);
    const patches: unknown[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (url.endsWith(`/guilds/${order.guildId}/channels`)) return Response.json([channel]);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        patches.push(body);
        channel = { ...channel, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;

    await expect(ticket.ensurePaidOrderTicket(order, { fetcher })).resolves.toMatchObject({
      created: false,
      welcomeMessageCreated: false,
      permissionsRepaired: true,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      permission_overwrites: expect.arrayContaining([
        { id: order.guildId, type: 0, allow: "0", deny: "1024" },
      ]),
    });
  });

  it("respeita um rate limit curto do Discord e tenta uma única vez novamente", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    const permissions = ticket.buildTicketPermissionOverwrites({
      guildId: order.guildId,
      buyerDiscordId: order.buyerDiscordId,
      botDiscordId: botId,
      closerDiscordUserIds: defaultCloseAdminUserIds,
    });
    const readyChannel = channelResponse(`gwstore-order:${order.orderId};welcome=1`, permissions);
    let channelRequests = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/guilds/${order.guildId}/channels`)) {
        channelRequests += 1;
        if (channelRequests === 1) return Response.json({ retry_after: 0 }, { status: 429 });
        return Response.json([readyChannel]);
      }
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch;

    await expect(ticket.ensurePaidOrderTicket(order, { fetcher })).resolves.toMatchObject({
      channelId,
      created: false,
      welcomeMessageCreated: false,
    });
    expect(channelRequests).toBe(2);
  });

  it("falha antes da rede para IDs inválidos", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(
      ticket.ensurePaidOrderTicket({ ...order, guildId: "not-a-guild" }, { fetcher }),
    ).rejects.toThrow("ID do servidor inválido");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function channelResponse(topic: string, permissionOverwrites: unknown[]) {
  return {
    id: channelId,
    type: 0,
    name: "ticket-9a845b407c4e",
    topic,
    permission_overwrites: permissionOverwrites,
  };
}
