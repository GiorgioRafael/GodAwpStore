import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toCardElement } from "chat";

vi.mock("server-only", () => ({}));

let catalogCards: typeof import("./discord-bot").catalogCards;
let getDiscordBot: typeof import("./discord-bot").getDiscordBot;
let postDiscordEphemeral: typeof import("./discord-bot").postDiscordEphemeral;

beforeAll(async () => {
  ({ catalogCards, getDiscordBot, postDiscordEphemeral } = await import("./discord-bot"));
});

afterEach(() => vi.unstubAllEnvs());

describe("Discord catalog cards", () => {
  it("renderiza todos os produtos em uma lista suspensa sem dados secretos", () => {
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
            imageUrl: null,
            products: [
              {
                id: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
                name: "Moon Blossom",
                description: null,
                priceCents: 100,
                availableStock: 2,
              },
            ],
          },
        ],
      },
    ]);

    const normalized = toCardElement(card);
    expect(normalized).toMatchObject({ type: "card", title: "GWStore · Produtos" });
    const serialized = JSON.stringify(normalized);
    expect(serialized).toContain("R$ 1,00");
    expect(serialized).toContain("2 unidades");
    expect(serialized).toContain('"id":"select_product"');
    expect(serialized).toContain('"type":"select"');
    expect(serialized).not.toContain('"id":"buy"');
    expect(serialized).not.toMatch(/encrypted_payload|auth_tag|fingerprint/i);
  });

  it("pagina o seletor quando o catálogo ultrapassa 25 produtos", () => {
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
            products: Array.from({ length: 26 }, (_, index) => ({
              id: `product-${index}`,
              name: `Produto ${index}`,
              description: null,
              priceCents: 100,
              availableStock: 1,
            })),
          },
        ],
      },
    ]);

    expect(cards).toHaveLength(2);
    expect(toCardElement(cards[0])).toMatchObject({ title: "GWStore · Produtos 1/2" });
    expect(toCardElement(cards[1])).toMatchObject({ title: "GWStore · Produtos 2/2" });
    expect(JSON.stringify(toCardElement(cards[0]))).not.toContain("product-25");
    expect(JSON.stringify(toCardElement(cards[1]))).toContain("product-25");
  });

  it("mostra estado vazio sem criar botão", () => {
    expect(JSON.stringify(toCardElement(catalogCards([])[0]))).toContain(
      "catálogo ainda não tem produtos ativos",
    );
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
    expect(JSON.stringify(payload.components)).toContain("select_product");
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
