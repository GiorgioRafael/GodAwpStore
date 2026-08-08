import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { rpc, createAdminSupabaseClient, loadBotRuntimeSettings } = vi.hoisted(
  () => {
    const rpc = vi.fn();
    return {
      rpc,
      createAdminSupabaseClient: vi.fn(() => ({ rpc })),
      loadBotRuntimeSettings: vi.fn(),
    };
  },
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient }));
vi.mock("./message-customization-server", () => ({ loadBotRuntimeSettings }));

import {
  ensureLatePaymentTicket,
  latePaymentTicketMarker,
  reconcileLatePaidOrderTickets,
} from "./late-payment-ticket";

const ORDER_ID = "417805df-0000-4000-8000-000000000001";
const GUILD_ID = "900000000000000010";
const BUYER_ID = "1162514331632672809";
const STAFF_ID = "900000000000000012";
const BOT_ID = "900000000000000099";
const CHANNEL_ID = "900000000000000020";

type Call = {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
};

function stubDiscord(existingChannels: unknown[] = []) {
  const calls: Call[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });

      if (url.endsWith("/users/@me"))
        return Response.json({ id: BOT_ID, bot: true });
      if (url.endsWith(`/guilds/${GUILD_ID}`))
        return Response.json({ id: GUILD_ID });
      if (url.endsWith(`/guilds/${GUILD_ID}/channels`) && method === "GET") {
        return Response.json(existingChannels);
      }
      if (url.endsWith(`/guilds/${GUILD_ID}/channels`) && method === "POST") {
        return Response.json({ id: CHANNEL_ID, type: 0 });
      }
      if (url.includes("/messages"))
        return Response.json({ id: "900000000000000021" });
      // Permissões desatualizadas são reparadas em vez de recriar o canal.
      if (url.endsWith(`/channels/${CHANNEL_ID}`) && method === "PATCH") {
        return Response.json({ id: CHANNEL_ID, type: 0 });
      }
      throw new Error(`requisição inesperada ${method} ${url}`);
    },
  ) as unknown as typeof fetch;
  return { fetcher, calls };
}

const INPUT = {
  orderId: ORDER_ID,
  guildDiscordId: GUILD_ID,
  buyerDiscordId: BUYER_ID,
  productName: "Ghost Pepper",
  quantity: 4,
  amountCents: 198,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_APPLICATION_ID", BOT_ID);
  loadBotRuntimeSettings.mockResolvedValue({
    customization: {},
    ticketCloseAdminDiscordUserIds: [STAFF_ID],
    ticketNotificationDiscordUserIds: [STAFF_ID],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("canal de recuperação de pagamento atrasado", () => {
  it("abre o canal e diz ao comprador que o dinheiro não se perdeu", async () => {
    const { fetcher, calls } = stubDiscord();

    const ticket = await ensureLatePaymentTicket(INPUT, { fetcher });

    expect(ticket).toEqual({ channelId: CHANNEL_ID, created: true });
    const created = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/channels"),
    );
    expect(created?.body?.topic).toBe(latePaymentTicketMarker(ORDER_ID));

    const message = calls.find((c) => c.url.includes("/messages"));
    const embed = (message?.body?.embeds as Array<Record<string, unknown>>)[0];
    expect(String(embed.description)).toContain("dinheiro não se perdeu");
    expect(String(message?.body?.content)).toContain(`<@${BUYER_ID}>`);
    // A equipe tem que ser chamada junto, senão ninguém vê.
    expect(String(message?.body?.content)).toContain(`<@${STAFF_ID}>`);
    // O comprador é mencionado de verdade, mas nada de @everyone.
    expect(message?.body?.allowed_mentions).toEqual({
      parse: [],
      users: [BUYER_ID],
    });
  });

  it("explica quando o Pix foi pago mas o último item esgotou", async () => {
    const { fetcher, calls } = stubDiscord();

    await ensureLatePaymentTicket(
      { ...INPUT, reason: "stock_unavailable_after_payment" },
      { fetcher },
    );

    const message = calls.find((c) => c.url.includes("/messages"));
    const embed = (message?.body?.embeds as Array<Record<string, unknown>>)[0];
    expect(embed.title).toBe("Pagamento confirmado, mas o item esgotou");
    expect(String(embed.description)).toContain("últimas unidades");
    expect(String(embed.description)).toContain("dinheiro não se perdeu");
  });

  it("reencontra o canal em vez de abrir outro", async () => {
    const { fetcher, calls } = stubDiscord([
      {
        id: CHANNEL_ID,
        type: 0,
        topic: latePaymentTicketMarker(ORDER_ID),
        permission_overwrites: [],
      },
    ]);

    const ticket = await ensureLatePaymentTicket(INPUT, { fetcher });

    expect(ticket.created).toBe(false);
    // Sem canal novo e sem repetir a mensagem para quem já foi avisado.
    expect(
      calls.some((c) => c.method === "POST" && c.url.endsWith("/channels")),
    ).toBe(false);
    expect(calls.some((c) => c.url.includes("/messages"))).toBe(false);
  });

  it("recusa dados que não são do Discord", async () => {
    const { fetcher } = stubDiscord();
    await expect(
      ensureLatePaymentTicket(
        { ...INPUT, buyerDiscordId: "nao-e-id" },
        { fetcher },
      ),
    ).rejects.toThrow();
    await expect(
      ensureLatePaymentTicket({ ...INPUT, orderId: "nao-e-uuid" }, { fetcher }),
    ).rejects.toThrow();
  });
});

describe("varredura dos pagamentos atrasados", () => {
  it("abre o canal e registra para não repetir na próxima passagem", async () => {
    const { fetcher } = stubDiscord();
    rpc.mockImplementation(async (name: string) =>
      name === "list_late_paid_orders_without_ticket"
        ? {
            data: [
              {
                late_order_id: ORDER_ID,
                late_guild_discord_id: GUILD_ID,
                late_buyer_discord_id: BUYER_ID,
                late_product_name: "Ghost Pepper",
                late_quantity: 4,
                late_amount_cents: 198,
                late_detected_at: "2026-07-27T20:14:16.000Z",
                late_reason: "stock_unavailable_after_payment",
              },
            ],
            error: null,
          }
        : {
            data: [
              { recorded_order_id: ORDER_ID, recorded_channel_id: CHANNEL_ID },
            ],
            error: null,
          },
    );

    const result = await reconcileLatePaidOrderTickets({ fetcher });

    expect(result).toEqual({ pending: 1, opened: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith("record_late_payment_ticket", {
      p_order_id: ORDER_ID,
      p_channel_id: CHANNEL_ID,
    });
    const messageCall = (
      fetcher as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.find(([url]) => String(url).includes("/messages"));
    expect(JSON.stringify(messageCall)).toContain("últimas unidades");
  });

  it("não marca como resolvido se o Discord recusar", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("Discord fora do ar");
    }) as unknown as typeof fetch;
    rpc.mockResolvedValue({
      data: [
        {
          late_order_id: ORDER_ID,
          late_guild_discord_id: GUILD_ID,
          late_buyer_discord_id: BUYER_ID,
          late_product_name: "Ghost Pepper",
          late_quantity: 4,
          late_amount_cents: 198,
          late_detected_at: "2026-07-27T20:14:16.000Z",
        },
      ],
      error: null,
    });

    const result = await reconcileLatePaidOrderTickets({ fetcher });

    // O pedido continua na lista, então a próxima passagem tenta de novo.
    expect(result).toEqual({ pending: 1, opened: 0, failed: 1 });
    expect(rpc).not.toHaveBeenCalledWith(
      "record_late_payment_ticket",
      expect.anything(),
    );
  });

  it("um pedido que falha não impede os outros", async () => {
    const { fetcher } = stubDiscord();
    rpc.mockImplementation(async (name: string) =>
      name === "list_late_paid_orders_without_ticket"
        ? {
            data: [
              {
                late_order_id: "nao-e-uuid",
                late_guild_discord_id: GUILD_ID,
                late_buyer_discord_id: BUYER_ID,
                late_product_name: "Quebrado",
                late_quantity: 1,
                late_amount_cents: 100,
                late_detected_at: "2026-07-27T20:00:00.000Z",
              },
              {
                late_order_id: ORDER_ID,
                late_guild_discord_id: GUILD_ID,
                late_buyer_discord_id: BUYER_ID,
                late_product_name: "Ghost Pepper",
                late_quantity: 4,
                late_amount_cents: 198,
                late_detected_at: "2026-07-27T20:14:16.000Z",
              },
            ],
            error: null,
          }
        : {
            data: [
              { recorded_order_id: ORDER_ID, recorded_channel_id: CHANNEL_ID },
            ],
            error: null,
          },
    );

    const result = await reconcileLatePaidOrderTickets({ fetcher });

    expect(result).toEqual({ pending: 2, opened: 1, failed: 1 });
  });
});
