import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
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
  },
}));

import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("Discord native quantity interactions", () => {
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
});
