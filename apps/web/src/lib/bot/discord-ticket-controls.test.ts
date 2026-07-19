import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildPaidTicketControlComponents,
  buildTicketPermissionOverwrites,
  DiscordTicketChannelMissingError,
  synchronizeOpenDiscordTicketControls,
  welcomeMessageMarker,
} from "./discord-ticket-controls";
import { DiscordApiError } from "./discord-api";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import type { BotRuntimeSettings } from "./message-customization-server";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const guildId = "123456789012345678";
const buyerId = "223456789012345678";
const botId = "323456789012345678";
const channelId = "423456789012345678";
const messageId = "523456789012345678";
const closeAdminId = "385924725332901909";
const notificationOnlyId = "911402638975844354";

const settings: BotRuntimeSettings = {
  customization: {
    ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
    ticket: {
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
      nicknameButtonLabel: "Adicionar nick",
      closeButtonLabel: "Encerrar ticket",
    },
  },
  ticketNotificationDiscordUserIds: [notificationOnlyId],
  ticketCloseAdminDiscordUserIds: [closeAdminId],
};

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", botId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Discord ticket controls", () => {
  it("libera o ticket para comprador, bot e fechadores sem duplicar membros", () => {
    expect(
      buildTicketPermissionOverwrites({
        guildId,
        buyerDiscordId: buyerId,
        botDiscordId: botId,
        closerDiscordUserIds: [closeAdminId, buyerId, closeAdminId, "invalid"],
        notificationDiscordUserIds: [notificationOnlyId, buyerId, "invalid"],
      }),
    ).toEqual([
      { id: guildId, type: 0, allow: "0", deny: "1024" },
      { id: buyerId, type: 1, allow: "84992", deny: "0" },
      { id: botId, type: 1, allow: "84992", deny: "0" },
      { id: notificationOnlyId, type: 1, allow: "84992", deny: "0" },
      { id: closeAdminId, type: 1, allow: "84992", deny: "0" },
    ]);
  });

  it("repara retroativamente permissoes e os dois botoes da mensagem inicial", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const requests: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
    const fetcher = controlsFetcher(requests, { permissionOverwrites: [], components: [] });

    await expect(
      synchronizeOpenDiscordTicketControls(
        { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
        { fetcher },
      ),
    ).resolves.toEqual({ permissionsUpdated: true, welcomeMessageUpdated: true });

    const channelPatch = requests.find(
      (request) => request.method === "PATCH" && request.url.endsWith(`/channels/${channelId}`),
    );
    expect(channelPatch?.headers.get("authorization")).toBe("Bot bot-token");
    expect(channelPatch?.body).toEqual({
      permission_overwrites: [
        { id: guildId, type: 0, allow: "0", deny: "1024" },
        { id: buyerId, type: 1, allow: "84992", deny: "0" },
        { id: botId, type: 1, allow: "84992", deny: "0" },
        { id: notificationOnlyId, type: 1, allow: "84992", deny: "0" },
        { id: closeAdminId, type: 1, allow: "84992", deny: "0" },
      ],
    });

    const messagePatch = requests.find(
      (request) =>
        request.method === "PATCH" &&
        request.url.endsWith(`/channels/${channelId}/messages/${messageId}`),
    );
    expect(messagePatch?.body).toEqual({
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              custom_id: `gwstore_game_nickname:${orderId}`,
              label: "Adicionar nick",
            },
            {
              type: 2,
              style: 4,
              custom_id: `gwstore_ticket_close:${orderId}`,
              label: "Encerrar ticket",
            },
          ],
        },
      ],
    });
  });

  it("nao faz PATCH quando o ticket ja possui as permissoes e botoes atuais", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const requests: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];
    const expectedOverwrites = buildTicketPermissionOverwrites({
      guildId,
      buyerDiscordId: buyerId,
      botDiscordId: botId,
      closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
      notificationDiscordUserIds: settings.ticketNotificationDiscordUserIds,
    });
    const expectedComponents = buildPaidTicketControlComponents(
      orderId,
      settings.customization,
    );

    await expect(
      synchronizeOpenDiscordTicketControls(
        { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
        {
          fetcher: controlsFetcher(requests, {
            permissionOverwrites: expectedOverwrites,
            components: expectedComponents,
          }),
        },
      ),
    ).resolves.toEqual({ permissionsUpdated: false, welcomeMessageUpdated: false });

    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("pagina o historico quando a mensagem inicial nao esta entre as 100 mais recentes", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const expectedOverwrites = buildTicketPermissionOverwrites({
      guildId,
      buyerDiscordId: buyerId,
      botDiscordId: botId,
      closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
      notificationDiscordUserIds: settings.ticketNotificationDiscordUserIds,
    });
    const requestedUrls: string[] = [];
    const recentMessages = Array.from({ length: 100 }, (_, index) => ({
      id: String(600000000000000000n + BigInt(index)),
      author: { id: botId },
      embeds: [],
      components: [],
    }));
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requestedUrls.push(url);
      if (url.endsWith(`/channels/${channelId}`) && method === "GET") {
        return Response.json({
          id: channelId,
          guild_id: guildId,
          type: 0,
          topic: `gwstore-order:${orderId};welcome=1`,
          permission_overwrites: expectedOverwrites,
        });
      }
      if (url.endsWith("/users/@me")) return Response.json({ id: botId, bot: true });
      if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ id: guildId });
      if (url.includes(`/channels/${channelId}/messages?limit=100&before=`)) {
        return Response.json([
          {
            id: messageId,
            author: { id: botId },
            embeds: [{ footer: { text: welcomeMessageMarker(orderId) } }],
            components: [],
          },
        ]);
      }
      if (url.endsWith(`/channels/${channelId}/messages?limit=100`)) {
        return Response.json(recentMessages);
      }
      if (url.endsWith(`/channels/${channelId}/messages/${messageId}`) && method === "PATCH") {
        return Response.json({ id: messageId });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    }) as unknown as typeof fetch;

    await expect(
      synchronizeOpenDiscordTicketControls(
        { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
        { fetcher },
      ),
    ).resolves.toEqual({ permissionsUpdated: false, welcomeMessageUpdated: true });

    expect(
      requestedUrls.filter((url) => url.includes(`/channels/${channelId}/messages?`)),
    ).toHaveLength(2);
  });

  it("recusa canal forjado antes de alterar permissoes ou mensagens", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const requests: Array<{ url: string; method: string; body: unknown; headers: Headers }> = [];

    await expect(
      synchronizeOpenDiscordTicketControls(
        { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
        {
          fetcher: controlsFetcher(requests, {
            permissionOverwrites: [],
            components: [],
            topic: "gwstore-order:7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f;welcome=1",
          }),
        },
      ),
    ).rejects.toThrow(/n.o corresponde/);

    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("identifica somente o 404 do GET inicial como canal de ticket ausente", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botId, bot: true });
      }
      if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ id: guildId });
      return Response.json(
        { code: 10_003, message: "Unknown Channel" },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    const error = await synchronizeOpenDiscordTicketControls(
      { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
      { fetcher },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(DiscordTicketChannelMissingError);
    expect(error).toMatchObject({ orderId, channelId });
    expect((error as Error).cause).toBeInstanceOf(DiscordApiError);
    expect(requestedUrls).toEqual([
      "https://discord.com/api/v10/users/@me",
      `https://discord.com/api/v10/guilds/${guildId}`,
      `https://discord.com/api/v10/channels/${channelId}`,
      `https://discord.com/api/v10/guilds/${guildId}`,
    ]);
  });

  it.each<[string, () => Response, number | null]>([
    [
      "404 sem JSON Discord",
      () => new Response("proxy not found", { status: 404 }),
      null,
    ],
    [
      "outro recurso Discord ausente",
      () =>
        Response.json(
          { code: 10_008, message: "Unknown Message" },
          { status: 404 },
        ),
      10_008,
    ],
  ])(
    "não classifica %s como canal ausente",
    async (_label, createResponse, discordCode) => {
      vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/users/@me")) {
          return Response.json({ id: botId, bot: true });
        }
        if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ id: guildId });
        return createResponse();
      }) as unknown as typeof fetch;

      const error = await synchronizeOpenDiscordTicketControls(
        { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
        { fetcher },
      ).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(DiscordApiError);
      expect(error).not.toBeInstanceOf(DiscordTicketChannelMissingError);
      expect(error).toMatchObject({ status: 404, discordCode });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it("valida a identidade do bot antes de consultar o canal", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_APPLICATION_ID", "623456789012345678");
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({ id: botId, bot: true });
    }) as unknown as typeof fetch;

    await expect(
      synchronizeOpenDiscordTicketControls(
        { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
        { fetcher },
      ),
    ).rejects.toThrow(/n.o corresponde ao aplicativo Discord/);

    expect(requestedUrls).toEqual(["https://discord.com/api/v10/users/@me"]);
  });

  it("exige o ID do aplicativo antes de qualquer consulta ou reconciliação", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "");
    const fetcher = vi.fn();

    const error = await synchronizeOpenDiscordTicketControls(
      { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
      { fetcher },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DiscordTicketChannelMissingError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [403, { code: 50_001, message: "Missing Access" }],
    [404, { code: 10_003, message: "Unknown Channel" }],
  ])("não reconcilia canal quando o guild retorna %s", async (status, payload) => {
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botId, bot: true });
      }
      if (url.endsWith(`/guilds/${guildId}`)) {
        return Response.json(payload, { status });
      }
      return Response.json(
        { code: 10_003, message: "Unknown Channel" },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    const error = await synchronizeOpenDiscordTicketControls(
      { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
      { fetcher },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).not.toBeInstanceOf(DiscordTicketChannelMissingError);
    expect(requestedUrls).toEqual([
      "https://discord.com/api/v10/users/@me",
      `https://discord.com/api/v10/guilds/${guildId}`,
    ]);
  });

  it("revalida o guild depois de Unknown Channel antes de sinalizar reconciliação", async () => {
    let guildChecks = 0;
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botId, bot: true });
      }
      if (url.endsWith(`/guilds/${guildId}`)) {
        guildChecks += 1;
        return guildChecks === 1
          ? Response.json({ id: guildId })
          : Response.json(
              { code: 50_001, message: "Missing Access" },
              { status: 403 },
            );
      }
      return Response.json(
        { code: 10_003, message: "Unknown Channel" },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    const error = await synchronizeOpenDiscordTicketControls(
      { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
      { fetcher },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).not.toBeInstanceOf(DiscordTicketChannelMissingError);
    expect(requestedUrls).toEqual([
      "https://discord.com/api/v10/users/@me",
      `https://discord.com/api/v10/guilds/${guildId}`,
      `https://discord.com/api/v10/channels/${channelId}`,
      `https://discord.com/api/v10/guilds/${guildId}`,
    ]);
  });

  it("mantem 404 posterior da mensagem como falha da API Discord", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const expectedOverwrites = buildTicketPermissionOverwrites({
      guildId,
      buyerDiscordId: buyerId,
      botDiscordId: botId,
      closerDiscordUserIds: settings.ticketCloseAdminDiscordUserIds,
      notificationDiscordUserIds: settings.ticketNotificationDiscordUserIds,
    });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/channels/${channelId}`)) {
        return Response.json({
          id: channelId,
          guild_id: guildId,
          type: 0,
          topic: `gwstore-order:${orderId};welcome=1`,
          permission_overwrites: expectedOverwrites,
        });
      }
      if (url.endsWith("/users/@me")) return Response.json({ id: botId, bot: true });
      if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ id: guildId });
      if (url.includes(`/channels/${channelId}/messages?`)) {
        return Response.json(
          { code: 10_008, message: "Unknown Message" },
          { status: 404 },
        );
      }
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch;

    const error = await synchronizeOpenDiscordTicketControls(
      { orderId, guildId, buyerDiscordId: buyerId, channelId, settings },
      { fetcher },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).not.toBeInstanceOf(DiscordTicketChannelMissingError);
    expect(error).toMatchObject({
      status: 404,
      path: `/channels/${channelId}/messages?limit=100`,
      method: "GET",
      discordCode: 10_008,
    });
  });
});

function controlsFetcher(
  requests: Array<{ url: string; method: string; body: unknown; headers: Headers }>,
  options: {
    permissionOverwrites: unknown[];
    components: unknown;
    topic?: string;
  },
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const headers = new Headers(init?.headers);
    requests.push({ url, method, body, headers });

    if (url.endsWith(`/channels/${channelId}`) && method === "GET") {
      return Response.json({
        id: channelId,
        guild_id: guildId,
        type: 0,
        topic: options.topic ?? `gwstore-order:${orderId};welcome=1`,
        permission_overwrites: options.permissionOverwrites,
      });
    }
    if (url.endsWith("/users/@me")) {
      return Response.json({ id: botId, bot: true });
    }
    if (url.endsWith(`/guilds/${guildId}`)) return Response.json({ id: guildId });
    if (url.endsWith(`/channels/${channelId}/messages?limit=100`)) {
      return Response.json([
        {
          id: messageId,
          author: { id: botId },
          embeds: [{ footer: { text: welcomeMessageMarker(orderId) } }],
          components: options.components,
        },
      ]);
    }
    if (method === "PATCH") return Response.json({ id: channelId });
    throw new Error(`unexpected request ${method} ${url}`);
  }) as unknown as typeof fetch;
}
