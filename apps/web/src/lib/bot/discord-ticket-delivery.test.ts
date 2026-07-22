import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDeliveryMessage,
  completeDiscordTicketDelivery,
  createNativeDiscordTicketDeliveryResponse,
  parseNativeDiscordTicketDeliveryInteraction,
  ticketDeliveryInteractionId,
  type DiscordTicketDeliveryRepository,
} from "./discord-ticket-delivery";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import type { BotRuntimeSettings } from "./message-customization-server";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const guildId = "123456789012345678";
const channelId = "223456789012345678";
const buyerId = "323456789012345678";
const adminId = "423456789012345678";
const botId = "523456789012345678";
const feedbackChannelId = "623456789012345678";
const interactionToken = "ticket_delivery_interaction_token";

const settings: BotRuntimeSettings = {
  customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  ticketNotificationDiscordUserIds: [],
  ticketCloseAdminDiscordUserIds: [adminId],
};

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", botId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Discord paid-ticket delivery message", () => {
  it("gera e reconhece somente o ID de interacao valido", () => {
    expect(ticketDeliveryInteractionId(orderId)).toBe(
      `gwstore_ticket_delivery:${orderId}`,
    );
    expect(parseNativeDiscordTicketDeliveryInteraction(interaction())).toEqual({
      orderId,
    });
    expect(
      parseNativeDiscordTicketDeliveryInteraction({
        ...interaction(),
        data: { custom_id: "gwstore_ticket_delivery:not-an-order" },
      }),
    ).toBeNull();
  });

  it("difere o clique autorizado e recusa os demais de forma privada", () => {
    expect(createNativeDiscordTicketDeliveryResponse(interaction(), settings)).toEqual({
      authorized: true,
      response: { type: 5, data: { flags: 64 } },
    });

    const unauthorized = createNativeDiscordTicketDeliveryResponse(
      interaction("723456789012345678"),
      settings,
    );
    expect(unauthorized.authorized).toBe(false);
    expect(unauthorized.response).toMatchObject({
      type: 4,
      data: {
        content: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliveryUnauthorizedText,
        flags: 64,
        allowed_mentions: { parse: [] },
        components: [],
      },
    });
  });

  it("envia a mensagem da entrega, menciona somente o comprador e aponta feedbacks", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = deliveryFetcher(requests);

    await expect(
      completeDiscordTicketDelivery(interaction(), settings, {
        repository: repository(),
        fetcher,
      }),
    ).resolves.toEqual({
      status: "sent",
      buyerDiscordId: buyerId,
      feedbackChannelId,
    });

    const sent = requests.find(
      (request) =>
        request.method === "POST" &&
        request.url.endsWith(`/channels/${channelId}/messages`),
    );
    expect(sent?.body).toMatchObject({
      content: [
        `<@${buyerId}>`,
        "✅ Entrega concluída!",
        "",
        "Se puder, deixa um feedback aqui no servidor 🙏",
        "Isso ajuda muito a loja a crescer.",
        "",
        "Obrigado pela preferência 👑",
        `<#${feedbackChannelId}>`,
      ].join("\n"),
      allowed_mentions: {
        parse: [],
        users: [buyerId],
        replied_user: false,
      },
      enforce_nonce: true,
    });
    expect(String((sent?.body as { nonce?: string })?.nonce)).toHaveLength(25);

    const confirmation = requests.find((request) =>
      request.url.includes("/messages/@original"),
    );
    expect(confirmation?.body).toEqual({
      content: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliverySuccessText,
      components: [],
      allowed_mentions: { parse: [] },
    });
  });

  it("nao duplica a mensagem quando o bot ja concluiu a entrega", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = deliveryFetcher(requests, {
      existingMessages: [
        {
          id: "823456789012345678",
          author: { id: botId },
          content: buildDeliveryMessage(
            buyerId,
            DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliveryMessageText,
            feedbackChannelId,
          ),
        },
      ],
    });

    await expect(
      completeDiscordTicketDelivery(interaction(), settings, {
        repository: repository(),
        fetcher,
      }),
    ).resolves.toEqual({ status: "already_sent" });

    expect(
      requests.some(
        (request) =>
          request.method === "POST" &&
          request.url.endsWith(`/channels/${channelId}/messages`),
      ),
    ).toBe(false);
    expect(requests.find((request) => request.url.includes("/messages/@original"))?.body)
      .toMatchObject({
        content: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliveryAlreadySentText,
      });
  });

  it("recusa pedido que nao corresponde ao servidor e canal assinados", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = deliveryFetcher(requests);

    await expect(
      completeDiscordTicketDelivery(interaction(), settings, {
        repository: repository({ guildId: "923456789012345678" }),
        fetcher,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });
});

function interaction(userId = adminId) {
  return {
    id: "923456789012345679",
    application_id: botId,
    token: interactionToken,
    type: 3,
    guild_id: guildId,
    channel_id: channelId,
    member: { user: { id: userId } },
    data: { custom_id: `gwstore_ticket_delivery:${orderId}` },
  };
}

function repository(
  overrides: Partial<Awaited<ReturnType<DiscordTicketDeliveryRepository["find"]>>> = {},
): DiscordTicketDeliveryRepository {
  return {
    find: vi.fn(async () => ({
      orderId,
      guildId,
      buyerDiscordId: buyerId,
      channelId,
      ticketStatus: "open",
      orderStatus: "processing",
      paymentStatus: "paid",
      paidAt: "2026-07-22T12:00:00.000Z",
      ...overrides,
    })),
  };
}

function deliveryFetcher(
  requests: Array<{ url: string; method: string; body: unknown }>,
  options: { existingMessages?: unknown[] } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });

    if (url.endsWith("/users/@me") && method === "GET") {
      return Response.json({ id: botId, bot: true });
    }
    if (url.endsWith(`/guilds/${guildId}`) && method === "GET") {
      return Response.json({ id: guildId });
    }
    if (url.endsWith(`/guilds/${guildId}/channels`) && method === "GET") {
      return Response.json([
        { id: "723456789012345678", type: 0, name: "geral" },
        { id: feedbackChannelId, type: 0, name: "✅┊feedbacks" },
      ]);
    }
    if (
      url.endsWith(`/channels/${channelId}/messages?limit=100`) &&
      method === "GET"
    ) {
      return Response.json(options.existingMessages ?? []);
    }
    if (url.endsWith(`/channels/${channelId}/messages`) && method === "POST") {
      return Response.json({ id: "823456789012345678" });
    }
    if (url.includes(`/webhooks/${botId}/${interactionToken}/messages/@original`)) {
      return Response.json({ id: "923456789012345678" });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as unknown as typeof fetch;
}
