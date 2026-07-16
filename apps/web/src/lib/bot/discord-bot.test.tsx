import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toCardElement } from "chat";

vi.mock("server-only", () => ({}));

let catalogCards: typeof import("./discord-bot").catalogCards;
let getDiscordBot: typeof import("./discord-bot").getDiscordBot;

beforeAll(async () => {
  ({ catalogCards, getDiscordBot } = await import("./discord-bot"));
});

afterEach(() => vi.unstubAllEnvs());

describe("Discord catalog cards", () => {
  it("renderiza preço, estoque e botão de compra sem dados secretos", () => {
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
    expect(normalized).toMatchObject({ type: "card", title: "Grow a Garden 2 · Seeds" });
    const serialized = JSON.stringify(normalized);
    expect(serialized).toContain("R$ 1,00");
    expect(serialized).toContain("2 em estoque");
    expect(serialized).toContain('"id":"buy"');
    expect(serialized).not.toMatch(/encrypted_payload|auth_tag|fingerprint/i);
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
});
