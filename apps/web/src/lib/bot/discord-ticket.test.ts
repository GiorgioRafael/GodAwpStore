import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import { DiscordApiError } from "./discord-api";

vi.mock("server-only", () => ({}));
const { resolveGwStoreOrderTicketKind } = vi.hoisted(() => ({ resolveGwStoreOrderTicketKind: vi.fn() }));
vi.mock("./gw-up-ticket-routing", () => ({ resolveGwStoreOrderTicketKind }));
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

beforeEach(() => {
  resolveGwStoreOrderTicketKind.mockReset().mockResolvedValue("purchase");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Discord paid-order ticket", () => {
  it.each([
    ["João.Comprador", "robux-joao-comprador"],
    ["speedy_123", "robux-speedy_123"],
    ["🔥", `robux-${order.buyerDiscordId}`],
    [null, `robux-${order.buyerDiscordId}`],
    ["a".repeat(120), `robux-${"a".repeat(94)}`],
  ])("nomeia ticket de Robux pelo comprador (%s), sem duplicar em reenvios", async (username, expectedName) => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "secret-ticket-token");
    let channel: ReturnType<typeof channelResponse> | null = null;
    const creates: Array<{ name: string; topic: string }> = [];
    let profileReads = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "GET") return Response.json(channel ? [channel] : []);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/users/${order.buyerDiscordId}`)) {
        profileReads += 1;
        return username === null ? Response.json({}, { status: 503 }) : Response.json({ id: order.buyerDiscordId, username });
      }
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "POST") {
        creates.push(body);
        channel = { ...channelResponse(body.topic, body.permission_overwrites), name: body.name };
        return Response.json(channel, { status: 201 });
      }
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") return Response.json({ id: "723456789012345678" });
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel!, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;
    const robuxOrder = { ...order, productName: "Robux", controls: "robux" as const };
    expect(await ticket.ensurePaidOrderTicket(robuxOrder, { fetcher })).toMatchObject({ channelName: expectedName, created: true });
    expect(await ticket.ensurePaidOrderTicket(robuxOrder, { fetcher })).toMatchObject({ channelName: expectedName, created: false });
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ name: expectedName, topic: `gwstore-order:${order.orderId}` });
    expect(profileReads).toBe(1);
  });

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
              style: 3,
              custom_id: `gwstore_ticket_delivery:${order.orderId}`,
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
    expect(JSON.stringify(welcome?.body)).toContain("`2x Dragon Breath @everyone`");
    expect(JSON.stringify(welcome?.body)).not.toContain("secret-ticket-token");
  });

  it("separa cada produto do carrinho em uma linha copiável com sua quantidade", () => {
    const payload = ticket.paidTicketWelcomeMessage({
      ...order,
      productName:
        "Promoções GAG2 - 100x Ghost Pepper ×1, Promoções GAG2 - 50x Sun Bloom ×1, Promoções GAG2 - 10x Star Fruit ×1",
      quantity: 3,
    });
    const fields = payload.embeds[0]?.fields ?? [];

    expect(fields[0]?.value).toBe(
      [
        "`1x Promoções GAG2 - 100x Ghost Pepper`",
        "`1x Promoções GAG2 - 50x Sun Bloom`",
        "`1x Promoções GAG2 - 10x Star Fruit`",
      ].join("\n"),
    );
    expect(fields).toHaveLength(3);
    expect(fields.some((field) => field.name === "Quantidade")).toBe(false);
  });

  it.each([
    [false, undefined, "purchase"], [true, undefined, "purchase"],
    [false, "robux", "purchase"], [true, "robux", "purchase"],
    [false, undefined, "up"], [true, undefined, "up"],
    [false, undefined, "failure"], [true, undefined, "failure"],
  ] as const)("encaminha ticket GW para sua categoria (recuperado=%s, controles=%s, classificação=%s), preservando acesso", async (existing, controls, kind) => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    if (kind === "failure") resolveGwStoreOrderTicketKind.mockRejectedValue(new Error("banco indisponível"));
    else resolveGwStoreOrderTicketKind.mockResolvedValue(kind);
    const guildId = "1401264061101899820";
    const categoryId = "823456789012345678";
    const permissions = ticket.buildTicketPermissionOverwrites({
      guildId, buyerDiscordId: order.buyerDiscordId, botDiscordId: botId,
      closerDiscordUserIds: defaultCloseAdminUserIds,
      notificationDiscordUserIds: [defaultNotificationUserId],
    });
    let channel: (ReturnType<typeof channelResponse> & { parent_id?: string }) | null = existing
      ? { ...channelResponse(`gwstore-order:${order.orderId};welcome=1`, permissions), parent_id: "923456789012345678" }
      : null;
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/users/${order.buyerDiscordId}`)) return Response.json({ id: order.buyerDiscordId, username: "comprador" });
      if (url.endsWith(`/guilds/${guildId}/channels`) && method === "GET") {
        return Response.json([{ id: categoryId, type: 4, name: kind === "up" ? "🆙┊UPPER" : "🛒┊COMPRA" }, ...(channel ? [channel] : [])]);
      }
      if (url.endsWith(`/guilds/${guildId}/channels`) && method === "POST") {
        channel = { ...channelResponse(body.topic, body.permission_overwrites), ...body };
        return Response.json(channel);
      }
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") return Response.json({ id: "723456789012345678" });
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel!, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;

    await expect(ticket.ensurePaidOrderTicket({ ...order, guildId, controls,
      parentChannelId: "923456789012345678" }, { fetcher })).resolves.toMatchObject({ created: !existing });
    const creates = calls.filter(call => call.method === "POST" && call.url.endsWith(`/guilds/${guildId}/channels`));
    expect(creates).toHaveLength(existing ? 0 : 1);
    if (!existing) expect(creates[0]?.body).toMatchObject({ parent_id: categoryId, permission_overwrites: permissions });
    const moves = calls.filter(call => call.method === "PATCH" && call.body?.parent_id);
    expect(moves.map(call => call.body)).toEqual(existing ? [{ parent_id: categoryId }] : []);
    expect(channel?.permission_overwrites).toEqual(permissions);
    expect(channel?.parent_id).toBe(categoryId);
    if (controls === "robux") expect(resolveGwStoreOrderTicketKind).not.toHaveBeenCalled();
    else expect(resolveGwStoreOrderTicketKind).toHaveBeenCalledWith(guildId, order.orderId);
    expect(log).toHaveBeenCalledTimes(kind === "failure" ? 1 : 0);
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

  it("uses a plain nickname prompt when a paid ticket has no order controls", () => {
    const payload = ticket.paidTicketWelcomeMessage({
      ...order,
      productName: "Robux",
      quantity: 1_000,
      paidAmountCents: 3_500,
      controls: false,
    });

    expect(payload.content).toContain("envie seu nick no jogo neste ticket");
    expect(payload.content).not.toContain("botão abaixo");
    expect(payload.components).toEqual([]);
  });

  it("gives a Robux ticket the delivery and close controls without the item nickname modal", () => {
    const payload = ticket.paidTicketWelcomeMessage({
      ...order,
      productName: "Robux",
      quantity: 1_000,
      paidAmountCents: 4_000,
      controls: "robux",
    });

    expect(payload.content).toContain("envie seu nick no jogo neste ticket");
    expect(payload.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: `gwstore_ticket_delivery:${order.orderId}`,
            label: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliveryButtonLabel,
          },
          {
            type: 2,
            style: 4,
            custom_id: `gwstore_ticket_close:${order.orderId}`,
            label: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeButtonLabel,
          },
        ],
      },
    ]);
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

  it("permite respostas de criação mais lentas que quatro segundos sem abortar a entrega", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    let channel = channelResponse(`gwstore-order:${order.orderId}`, []);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal?.reason);
        }, { once: true });
      });
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "GET") return Response.json([]);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "POST") {
        channel = channelResponse(body.topic, body.permission_overwrites);
        return Response.json(channel, { status: 201 });
      }
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") return Response.json({ id: "723456789012345678" });
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;
    const task = ticket.ensurePaidOrderTicket(order, { fetcher });
    const completed = expect(task).resolves.toMatchObject({ created: true, welcomeMessageCreated: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await completed;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
  });

  it.each(["channel", "welcome"] as const)("recupera criação com resposta perdida (%s) sem repetir canal ou mensagem", async (unknownOutcome) => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    let channel: ReturnType<typeof channelResponse> | null = null;
    let message: { id: string; author: { id: string }; embeds: unknown } | null = null;
    let channelCreates = 0;
    let messageCreates = 0;
    let welcomeNonce: string | null = null;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "GET") return Response.json(channel ? [channel] : []);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/guilds/${order.guildId}/channels`) && method === "POST") {
        channelCreates++;
        channel = channelResponse(body.topic, body.permission_overwrites);
        if (unknownOutcome === "channel") throw new DOMException("Response lost", "TimeoutError");
        return Response.json(channel, { status: 201 });
      }
      if (url.endsWith(`/channels/${channelId}/messages?limit=100`)) return Response.json(message ? [message] : []);
      if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") {
        messageCreates++;
        welcomeNonce = body.nonce;
        message = { id: "723456789012345678", author: { id: botId }, embeds: body.embeds };
        if (unknownOutcome === "welcome") throw new DOMException("Response lost", "TimeoutError");
        return Response.json(message);
      }
      if (url.endsWith(`/channels/${channelId}`) && method === "PATCH") {
        channel = { ...channel!, ...body };
        return Response.json(channel);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;
    await expect(ticket.ensurePaidOrderTicket(order, { fetcher })).rejects.toThrow("Discord não respondeu à operação do ticket no prazo (POST");
    expect(channelCreates).toBe(1);
    await expect(ticket.ensurePaidOrderTicket(order, { fetcher })).resolves.toMatchObject({ channelId, created: false });
    expect(channelCreates).toBe(1);
    expect(messageCreates).toBe(1);
    expect(welcomeNonce).toBe(ticket.paidTicketWelcomeMessage(order).nonce);
    expect(channel).toMatchObject({ topic: `gwstore-order:${order.orderId};welcome=1` });
  });

  it("preserva o código Discord e a operação quando a criação é recusada", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      if (url.endsWith(`/guilds/${order.guildId}/channels`)) {
        return init?.method === "POST"
          ? Response.json({ code: 50035, message: "Invalid Form Body" }, { status: 400 })
          : Response.json([]);
      }
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch;
    const error = await ticket.ensurePaidOrderTicket(order, { fetcher }).catch(error => error);
    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).toMatchObject({ status: 400, discordCode: 50035, method: "POST", path: `/guilds/${order.guildId}/channels` });
  });

  it.each([10_001, 500_000])("permite recuperar tickets de %s Robux dentro do limite de compra", async (quantity) => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    const permissions = ticket.buildTicketPermissionOverwrites({
      guildId: order.guildId, buyerDiscordId: order.buyerDiscordId, botDiscordId: botId,
      closerDiscordUserIds: defaultCloseAdminUserIds,
      notificationDiscordUserIds: [defaultNotificationUserId],
    });
    const readyChannel = channelResponse(`gwstore-order:${order.orderId};welcome=1`, permissions);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/guilds/${order.guildId}/channels`)) return Response.json([readyChannel]);
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch;
    await expect(ticket.ensurePaidOrderTicket({ ...order, productName: "Robux", quantity, controls: "robux" }, { fetcher }))
      .resolves.toMatchObject({ channelId, created: false });
  });

  it.each([
    [10_001, undefined], [500_001, "robux"],
  ] as const)("mantém a validação de quantidade excessiva (%s, %s) antes da rede", async (quantity, controls) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(ticket.ensurePaidOrderTicket({ ...order, quantity, controls }, { fetcher })).rejects.toThrow("Quantidade inválida");
    expect(fetcher).not.toHaveBeenCalled();
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
