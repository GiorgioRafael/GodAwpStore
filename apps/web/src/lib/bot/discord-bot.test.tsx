import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cardToDiscordPayload, DiscordContentFormat } from "@chat-adapter/discord";
import { toCardElement } from "chat";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";

vi.mock("server-only", () => ({}));

let catalogCards: typeof import("./discord-bot").catalogCards;
let collectDiscordProductOptionEmojis: typeof import("./discord-bot").collectDiscordProductOptionEmojis;
let configureDiscordProductEntrySelect: typeof import("./discord-bot").configureDiscordProductEntrySelect;
let createNativeDiscordQuantityResponse: typeof import("./discord-bot").createNativeDiscordQuantityResponse;
let getDiscordBot: typeof import("./discord-bot").getDiscordBot;
let postDiscordEphemeral: typeof import("./discord-bot").postDiscordEphemeral;
let purchaseResultCard: typeof import("./discord-bot").purchaseResultCard;
let parseNativeDiscordQuantityInteraction: typeof import("./discord-bot").parseNativeDiscordQuantityInteraction;
let selectedProductCard: typeof import("./discord-bot").selectedProductCard;
let updateDiscordEphemeralResponse: typeof import("./discord-bot").updateDiscordEphemeralResponse;

beforeAll(async () => {
  ({
    catalogCards,
    collectDiscordProductOptionEmojis,
    configureDiscordProductEntrySelect,
    createNativeDiscordQuantityResponse,
    getDiscordBot,
    postDiscordEphemeral,
    purchaseResultCard,
    parseNativeDiscordQuantityInteraction,
    selectedProductCard,
    updateDiscordEphemeralResponse,
  } = await import("./discord-bot"));
});

afterEach(() => vi.unstubAllEnvs());

describe("Discord catalog cards", () => {
  it("configura o seletor inicial para fechar após a primeira escolha", () => {
    const payload = {
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "select_products",
              max_values: 1,
              options: [{ value: "a" }, { value: "b" }, { value: "c" }, { value: "d" }],
            },
          ],
        },
      ],
    };

    configureDiscordProductEntrySelect(payload);
    expect(payload.components[0]?.components[0]).toMatchObject({
      min_values: 1,
      max_values: 1,
    });
  });

  it("renderiza somente o informe da loja e mantém os produtos no seletor", () => {
    const [card] = catalogCards([
      {
        id: "game",
        name: "Grow a Garden 2",
        substores: [
          {
            id: "seeds",
            name: "Seeds",
            title: "Seeds",
            description: "Sementes",
            colorHex: "#D4AF37",
            imageUrl: "https://example.com/storefront.png",
            products: [
              {
                id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
                name: "Moon Blossom",
                description: null,
                imageUrl: "https://example.com/products/moon-blossom.png",
                discordEmoji: {
                  id: "423456789012345678",
                  name: "gw_9a845b407c4e_a1b2c3d4",
                  animated: false,
                },
                priceCents: 100,
                availableStock: 2,
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    ]);

    const normalized = toCardElement(card);
    expect(normalized).toMatchObject({
      type: "card",
      title: "🛍️✨ GWSTORE • LOJA OFICIAL ✨🛍️",
    });
    const serialized = JSON.stringify(normalized);
    expect(serialized).toContain("R$ 1,00");
    expect(serialized).toContain("Estoque: 2");
    expect(serialized).toContain("Moon Blossom");
    expect(serialized).toContain("https://example.com/storefront.png");
    expect(serialized).not.toContain("https://example.com/products/moon-blossom.png");
    expect(serialized).not.toContain('"type":"section"');
    expect(serialized).not.toContain("Seeds");
    expect(serialized).toContain("🔒");
    expect(serialized).toContain("💠");
    expect(serialized).toContain('"id":"select_products"');
    expect(serialized).toContain(
      "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9:Moon Blossom",
    );
    expect(serialized).toContain('"type":"select"');
    expect(serialized).not.toContain('"id":"buy"');
    expect(serialized).not.toMatch(/encrypted_payload|auth_tag|fingerprint/i);

    if (!normalized) throw new Error("Cartão de catálogo inválido.");
    const payload = configureDiscordProductEntrySelect(
      cardToDiscordPayload(normalized, {
        contentFormat: DiscordContentFormat.ComponentsV2,
      }),
      collectDiscordProductOptionEmojis(card),
    );
    expect(JSON.stringify(payload)).toContain(
      '"emoji":{"id":"423456789012345678","name":"gw_9a845b407c4e_a1b2c3d4","animated":false}',
    );
  });

  it("respeita a ordem global salva mesmo entre sublojas diferentes", () => {
    const [card] = catalogCards([
      {
        id: "game",
        name: "Grow a Garden 2",
        substores: [
          {
            id: "seeds",
            name: "Seeds",
            title: "Seeds",
            description: "",
            colorHex: "#D4AF37",
            imageUrl: null,
            products: [
              {
                id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
                name: "Mega Seed",
                description: null,
                priceCents: 10,
                availableStock: 12,
                sortOrder: 2,
              },
            ],
          },
          {
            id: "pets",
            name: "Pets",
            title: "Pets",
            description: "",
            colorHex: "#D4AF37",
            imageUrl: null,
            products: [
              {
                id: "7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f",
                name: "Fire Fly",
                description: null,
                priceCents: 50,
                availableStock: 7,
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    ]);

    const serialized = JSON.stringify(toCardElement(card));
    expect(serialized.indexOf("Fire Fly")).toBeLessThan(serialized.indexOf("Mega Seed"));
  });

  it("mantém até 25 produtos em uma única mensagem", () => {
    const cards = catalogCards([
      {
        id: "game",
        name: "Grow a Garden 2",
        substores: [
          {
            id: "seeds",
            name: "Seeds",
            title: "Seeds",
            description: "",
            colorHex: "#D4AF37",
            imageUrl: null,
            products: Array.from({ length: 25 }, (_, index) => ({
              id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
              name: `Produto ${index}`,
              description: null,
              imageUrl: `https://example.com/products/${index}.png`,
              priceCents: 100,
              availableStock: 1,
              sortOrder: index,
            })),
          },
        ],
      },
    ]);

    expect(cards).toHaveLength(1);
    expect(toCardElement(cards[0])).toMatchObject({
      title: "🛍️✨ GWSTORE • LOJA OFICIAL ✨🛍️",
    });
    for (const card of cards) {
      const normalized = toCardElement(card);
      if (!normalized) throw new Error("Cartão de catálogo inválido.");
      expect(() => cardToDiscordPayload(normalized, {
        contentFormat: DiscordContentFormat.ComponentsV2,
      })).not.toThrow();
    }
  });

  it("rejeita mais de 25 produtos para impedir truncamento silencioso", () => {
    const products = Array.from({ length: 26 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Produto ${index}`,
      description: null,
      imageUrl: null,
      priceCents: 100,
      availableStock: 1,
      sortOrder: index,
    }));

    expect(() =>
      catalogCards([
        {
          id: "game",
          name: "Grow a Garden 2",
          substores: [
            {
              id: "seeds",
              name: "Seeds",
              title: "Seeds",
              description: "",
              colorHex: "#D4AF37",
              imageUrl: null,
              products,
            },
          ],
        },
      ]),
    ).toThrow("no máximo 25 produtos ativos");
  });

  it("mostra estado vazio sem criar botão", () => {
    expect(JSON.stringify(toCardElement(catalogCards([])[0]))).toContain(
      "catálogo está descansando",
    );
  });

  it("mostra produto selecionado com texto visual e compra via Pix", () => {
    const card = selectedProductCard({
      game: { id: "game", name: "Grow a Garden 2", substores: [] },
      substore: {
        id: "seeds",
        name: "Seeds",
        title: "Grow a Garden — Seeds",
        description: "Sementes",
        colorHex: "#65A30D",
        imageUrl: null,
        products: [],
      },
      product: {
        id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
        name: "Ghost Pepper",
        description: "Semente especial",
        priceCents: 10,
        availableStock: 318,
        sortOrder: 0,
      },
    });

    const serialized = JSON.stringify(toCardElement(card));
    expect(serialized).toContain("🌶️👻✨ Ghost Pepper");
    expect(serialized).toContain("R$ 0,10");
    expect(serialized).toContain("318 unidades");
    expect(serialized).toContain("10 unidades");
    expect(serialized).toContain("R$ 1,00");
    expect(serialized).toContain("🔢 Escolher quantidade 🛒");
    expect(serialized).toContain('"id":"choose_quantity"');
  });

  it("recalcula o mínimo ao abrir o formulário, ignorando o valor antigo do botão", async () => {
    const interaction = parseNativeDiscordQuantityInteraction({
      type: 3,
      data: {
        custom_id: "choose_quantity\n9a845b40-7c4e-4d25-9f3f-3cbd27f050c9:50",
      },
    });

    expect(interaction).toMatchObject({
      kind: "open",
      productId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
    });

    const response = await createNativeDiscordQuantityResponse(
      "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
      {
        findPurchasableProduct: vi.fn(async () => ({
          id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          name: "Ghost Pepper",
          minimumPriceCents: 5,
        })),
        countAvailableStock: vi.fn(async () => 100),
      },
    );
    expect(response).toMatchObject({
      type: 9,
      data: {
        components: [
          {
            components: [
              expect.objectContaining({
                label: "Quantidade (mínimo 20)",
                value: "20",
              }),
            ],
          },
        ],
      },
    });
  });

  it("adia a resposta do envio da quantidade como mensagem privada", () => {
    expect(
      parseNativeDiscordQuantityInteraction({
        type: 5,
        data: {
          custom_id: "gwstore_quantity:9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "quantity", value: "50" }] },
          ],
        },
      }),
    ).toEqual({ kind: "submit", response: { type: 5, data: { flags: 64 } } });
  });

  it("renderiza o checkout como botão seguro da LivePix", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const card = purchaseResultCard(
      {
        kind: "created",
        orderId: "cddc0f6c-d177-4435-9bf7-476380f0654c",
        productName: "Dragon's Breath",
        quantity: 3,
        unitPriceCents: 40,
        subtotalPriceCents: 120,
        totalPriceCents: 120,
        discountBps: 0,
        discountAmountCents: 0,
        discountReason: null,
      },
      "https://checkout.livepix.gg/payment-reference",
    );

    await postDiscordEphemeral(
      {
        application_id: "123456789012345678",
        token: "interaction-token-for-test-123456",
      },
      card,
      fetcher as typeof fetch,
    );

    const request = fetcher.mock.calls[0]?.[1];
    expect(String(request?.body)).toContain("https://checkout.livepix.gg/payment-reference");
    expect(String(request?.body)).toContain("PAGAR AGORA COM PIX");
    expect(String(request?.body)).toContain("🐉🔥");
    expect(String(request?.body)).toContain("3 unidades");
    expect(String(request?.body)).toContain("R$ 1,20");
    expect(String(request?.body)).toContain("cancelados automaticamente após **2 horas**");
    expect(String(request?.body)).toContain("estoque reservado é restabelecido");
  });

  it("mantém o aviso de expiração mesmo quando os textos editáveis estão vazios", () => {
    const customization = structuredClone(DEFAULT_BOT_MESSAGE_CUSTOMIZATION);
    customization.order.statusText = "";
    customization.order.paymentPrompt = "";

    const card = purchaseResultCard(
      {
        kind: "duplicate",
        orderId: "cddc0f6c-d177-4435-9bf7-476380f0654c",
        productName: "Dragon's Breath",
        quantity: 3,
        unitPriceCents: 40,
        subtotalPriceCents: 120,
        totalPriceCents: 120,
        discountBps: 0,
        discountAmountCents: 0,
        discountReason: null,
      },
      null,
      customization,
    );

    const serialized = JSON.stringify(toCardElement(card));
    expect(serialized).toContain("cancelados automaticamente após **2 horas**");
    expect(serialized).toContain("estoque reservado é restabelecido");
  });

  it("mostra subtotal e desconto de booster no checkout privado", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const card = purchaseResultCard({
      kind: "created",
      orderId: "cddc0f6c-d177-4435-9bf7-476380f0654c",
      productName: "Sun Bloom",
      quantity: 2,
      unitPriceCents: 2_500,
      subtotalPriceCents: 5_000,
      totalPriceCents: 4_750,
      discountBps: 500,
      discountAmountCents: 250,
      discountReason: "server_booster",
    });

    await postDiscordEphemeral(
      {
        application_id: "123456789012345678",
        token: "interaction-token-for-test-123456",
      },
      card,
      fetcher,
    );

    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain("Desconto Nitro Booster (5%)");
    expect(body).toContain("R$ 50,00");
    expect(body).toContain("R$ 47,50");
  });

  it("mostra o desconto do ranking no checkout privado", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const card = purchaseResultCard({
      kind: "created",
      orderId: "cddc0f6c-d177-4435-9bf7-476380f0654c",
      productName: "Sun Bloom",
      quantity: 2,
      unitPriceCents: 2_500,
      subtotalPriceCents: 5_000,
      totalPriceCents: 4_900,
      discountBps: 200,
      discountAmountCents: 100,
      discountReason: "customer_rank",
    });

    await postDiscordEphemeral(
      {
        application_id: "123456789012345678",
        token: "interaction-token-for-test-123456",
      },
      card,
      fetcher,
    );

    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain("Desconto do seu ranking (2%)");
    expect(body).toContain("R$ 50,00");
    expect(body).toContain("R$ 49,00");
  });

  it("conclui a resposta adiada do modal editando a mensagem privada original", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

    await updateDiscordEphemeralResponse(
      {
        application_id: "123456789012345678",
        token: "interaction-token-for-test-123456",
      },
      catalogCards([])[0],
      fetcher,
    );

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://discord.com/api/v10/webhooks/123456789012345678/interaction-token-for-test-123456/messages/@original",
    );
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("PATCH");
  });

  it("aceita PING assinado e rejeita corpo não verificado", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicDer = publicKey.export({ format: "der", type: "spki" });
    const publicKeyHex = publicDer.subarray(publicDer.length - 32).toString("hex");
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token-for-test");
    vi.stubEnv("DISCORD_PUBLIC_KEY", publicKeyHex);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-for-test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-for-test");

    const body = JSON.stringify({ type: 1, id: "223456789012345678", application_id: "123456789012345678" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
    const makeRequest = (requestSignature: string) =>
      new Request("https://gwstore.vercel.app/api/webhooks/discord", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": requestSignature,
          "x-signature-timestamp": timestamp,
        },
        body,
      });

    const validResponse = await getDiscordBot().webhooks.discord(makeRequest(signature));
    expect(validResponse.status).toBe(200);
    await expect(validResponse.json()).resolves.toEqual({ type: 1 });

    const invalidResponse = await getDiscordBot().webhooks.discord(makeRequest("00".repeat(64)));
    expect(invalidResponse.status).toBe(401);
  });

  it("envia detalhes e checkout como follow-up efêmero nativo do Discord", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const [card] = catalogCards([
      {
        id: "game",
        name: "Grow a Garden 2",
        substores: [
          {
            id: "seeds",
            name: "Seeds",
            title: "Seeds",
            description: "",
            colorHex: "#D4AF37",
            imageUrl: null,
            products: [
              {
                id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
                name: "Moon Blossom",
                description: null,
                priceCents: 100,
                availableStock: 2,
                sortOrder: 0,
              },
            ],
          },
        ],
      },
    ]);

    await postDiscordEphemeral(
      {
        application_id: "123456789012345678",
        token: "interaction-token-for-test-123456",
      },
      card,
      fetcher as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://discord.com/api/v10/webhooks/123456789012345678/interaction-token-for-test-123456",
    );
    const request = fetcher.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body)) as {
      allowed_mentions: { parse: string[] };
      components: unknown[];
      flags: number;
    };
    expect(payload.flags & 64).toBe(64);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(payload.components)).toContain("select_products");
    expect(JSON.stringify(payload.components)).toContain('"max_values":1');
  });

  it("rejeita follow-up que não pertence à aplicação configurada", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn();

    await expect(
      postDiscordEphemeral(
        {
          application_id: "999456789012345678",
          token: "interaction-token-for-test-123456",
        },
        catalogCards([])[0],
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("Interação Discord incompleta");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
