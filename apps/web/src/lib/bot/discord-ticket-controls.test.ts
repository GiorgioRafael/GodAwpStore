import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildPaidTicketControlComponents,
  buildTicketPermissionOverwrites,
  synchronizeOpenDiscordTicketControls,
  welcomeMessageMarker,
} from "./discord-ticket-controls";
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
      if (url.endsWith("/users/@me")) return Response.json({ id: botId });
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
    if (url.endsWith("/users/@me")) return Response.json({ id: botId });
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
