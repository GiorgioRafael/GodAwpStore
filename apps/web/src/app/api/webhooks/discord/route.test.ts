import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeDiscordCartSelection } from "@/lib/bot/discord-cart-selection";

const ticketDeliveryMocks = vi.hoisted(() => ({
  completeDiscordTicketDelivery: vi.fn(async () => ({ status: "sent" as const })),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/bot/message-customization-server", async () => {
  const { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } = await import(
    "@/lib/bot/message-customization"
  );
  const { DEFAULT_TICKET_NOTIFICATION_DISCORD_USER_IDS } = await import(
    "@/lib/bot/ticket-notifications"
  );
  const { DEFAULT_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS } = await import(
    "@/lib/bot/ticket-close-admins"
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
vi.mock("@/lib/bot/supabase-repository", () => ({
  SupabaseBotCommerceRepository: class {
    async findPurchasableProduct() {
      return {
        id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
        name: "Ghost Pepper",
        minimumPriceCents: 10,
      };
    }

    async countAvailableStock() {
      return 100;
    }

    async findPurchasableProducts(productIds: string[]) {
      return productIds.map((id, index) => ({
        id,
        name: ["Super Watering", "Super Sprinkler", "Dragon's Breath"][index] ?? "Produto",
        minimumPriceCents: 100 + index * 100,
      }));
    }

    async countAvailableStocks(productIds: string[]) {
      return new Map(productIds.map((id) => [id, 100]));
    }
  },
}));
vi.mock("@/lib/bot/discord-ticket-delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bot/discord-ticket-delivery")>()),
  completeDiscordTicketDelivery: ticketDeliveryMocks.completeDiscordTicketDelivery,
}));

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Discord native quantity interactions", () => {
  it("verifica a assinatura no carrinho progressivo e na abertura das quantidades", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));
    const productIds = [
      "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
      "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
      "5f8199d0-67f7-45ec-b597-8d5149568707",
    ];
    const productNames = ["Super Watering", "Super Sprinkler", "Dragon's Breath"];
    const initialBody = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      data: {
        custom_id: "select_products",
        values: [encodeDiscordCartSelection(productIds[0], productNames[0])],
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signedRequest = (body: string) =>
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": sign(
            null,
            Buffer.from(timestamp + body),
            privateKey,
          ).toString("hex"),
          "x-signature-timestamp": timestamp,
        },
        body,
      });

    const response = await POST(signedRequest(initialBody));

    expect(response.status).toBe(200);
    const review = await response.json();
    expect(review).toMatchObject({
      type: 4,
      data: {
        flags: 64,
        content: expect.stringContaining("Carrinho: 1/3"),
        components: [
          { components: [{ label: "Super Watering", disabled: true }] },
          { components: [{ custom_id: "gwc:continue" }] },
        ],
      },
    });

    const continueBody = JSON.stringify({
      type: 3,
      id: "323456789012345678",
      application_id: "123456789012345678",
      data: { custom_id: "gwc:continue" },
      message: review.data,
    });
    const modalResponse = await POST(signedRequest(continueBody));
    expect(modalResponse.status).toBe(200);
    await expect(modalResponse.json()).resolves.toMatchObject({
      type: 9,
      data: {
        title: "Quantidades (1/1)",
        components: [
          { components: [{ custom_id: "quantity_0", label: "Super Watering" }] },
        ],
      },
    });
  });

  it("verifica a assinatura antes de abrir o formulário de quantidade", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));

    const body = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      data: {
        custom_id: "choose_quantity\n9a845b40-7c4e-4d25-9f3f-3cbd27f050c9:50",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
    const request = (requestSignature: string) =>
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": requestSignature,
          "x-signature-timestamp": timestamp,
        },
        body,
      });

    const response = await POST(request(signature));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 9,
      data: {
        custom_id: "gwstore_quantity:9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
        components: [
          { components: [expect.objectContaining({ custom_id: "quantity", value: "10" })] },
        ],
      },
    });

    const invalid = await POST(request("00".repeat(64)));
    expect(invalid.status).toBe(401);
  });

  it("abre o formulário de nick somente depois de validar a assinatura", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));

    const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
    const body = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      guild_id: "323456789012345678",
      channel_id: "423456789012345678",
      member: { user: { id: "523456789012345678" } },
      data: {
        component_type: 2,
        custom_id: `gwstore_game_nickname:${orderId}`,
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
    const request = new Request("https://gwstore.vercel.app/api/webhooks/discord", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 9,
      data: {
        custom_id: `gwstore_game_nickname:${orderId}`,
        components: [
          {
            type: 18,
            component: {
              type: 4,
              custom_id: "game_nickname",
              min_length: 2,
              max_length: 64,
            },
          },
        ],
      },
    });
  });
});

describe("Discord native ticket close interactions", () => {
  it("verifica a assinatura e devolve confirmacao efemera ao fechador autorizado", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
    const body = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      guild_id: "323456789012345678",
      channel_id: "423456789012345678",
      member: { user: { id: "385924725332901909" } },
      data: {
        component_type: 2,
        custom_id: `gwstore_ticket_close:${orderId}`,
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

    const response = await POST(
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 4,
      data: {
        flags: 64,
        components: [
          {
            components: [
              { custom_id: `gwstore_ticket_close_confirm:${orderId}`, style: 4 },
              { custom_id: `gwstore_ticket_close_cancel:${orderId}`, style: 2 },
            ],
          },
        ],
      },
    });
  });

  it("rejeita uma interacao destrutiva assinada mas antiga", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const body = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      guild_id: "323456789012345678",
      channel_id: "423456789012345678",
      member: { user: { id: "385924725332901909" } },
      data: {
        component_type: 2,
        custom_id: "gwstore_ticket_close:9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
      },
    });
    const timestamp = String(Math.floor((Date.now() - 10 * 60 * 1_000) / 1_000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

    const response = await POST(
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Stale interaction");
  });
});

describe("Discord native ticket delivery interactions", () => {
  it("verifica a assinatura e difere a mensagem para o administrador autorizado", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
    const body = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      token: "route_ticket_delivery_interaction_token",
      guild_id: "323456789012345678",
      channel_id: "423456789012345678",
      member: { user: { id: "385924725332901909" } },
      data: {
        component_type: 2,
        custom_id: `gwstore_ticket_delivery:${orderId}`,
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

    const response = await POST(
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 5,
      data: { flags: 64 },
    });
  });

  it("responde privadamente sem executar a entrega para quem nao e administrador", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex"));
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const body = JSON.stringify({
      type: 3,
      id: "223456789012345678",
      application_id: "123456789012345678",
      token: "route_ticket_delivery_interaction_token",
      guild_id: "323456789012345678",
      channel_id: "423456789012345678",
      member: { user: { id: "523456789012345678" } },
      data: {
        component_type: 2,
        custom_id:
          "gwstore_ticket_delivery:9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

    const response = await POST(
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 4,
      data: {
        content: expect.stringContaining("Somente administradores"),
        flags: 64,
      },
    });
    expect(ticketDeliveryMocks.completeDiscordTicketDelivery).not.toHaveBeenCalled();
  });
});
