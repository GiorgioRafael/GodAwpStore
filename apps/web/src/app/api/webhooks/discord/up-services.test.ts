import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GW_UP_CATEGORIES, GW_UP_GUILD_ID } from "@/lib/bot/gw-up-catalog";
const callbacks = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: callbacks.after }));
import { POST } from "./route";
const keys = generateKeyPairSync("ed25519");
const publicDer = keys.publicKey.export({ format: "der", type: "spki" });
const productId = GW_UP_CATEGORIES[0].services[0].id;
function request(data: object, guildId = GW_UP_GUILD_ID, ageSeconds = 0, signatureOverride?: string) {
  const body = JSON.stringify({ type: 3, id: "223456789012345678", application_id: "123456789012345678", token: "route_up_interaction_token_12345678", guild_id: guildId, channel_id: "323456789012345678", member: { user: { id: "423456789012345678" } }, data });
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const signature = signatureOverride ?? sign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex");
  return new Request("https://gwstore.vercel.app/api/webhooks/discord", { method: "POST", body, headers: { "content-type": "application/json", "x-signature-ed25519": signature, "x-signature-timestamp": timestamp } });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("DISCORD_PUBLIC_KEY", publicDer.subarray(publicDer.length - 32).toString("hex")); vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678"); });
afterEach(() => vi.unstubAllEnvs());
describe("signed GW UP webhook", () => {
  it("abre o modal imediatamente sem esperar pelo banco", async () => {
    const response = await POST(request({ custom_id: `gwu:quantity:${productId}`, component_type: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ type: 9, data: { custom_id: `gwu:submit:${productId}` } });
    expect(callbacks.after).not.toHaveBeenCalled();
  });
  it("abre categorias em uma resposta privada adiada", async () => {
    const response = await POST(request({ custom_id: "gwu:category", component_type: 3, values: ["geral"] }));
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(callbacks.after).toHaveBeenCalledTimes(1);
  });
  it("bloqueia o formulário em outro servidor", async () => {
    const response = await POST(request({ custom_id: `gwu:quantity:${productId}`, component_type: 2 }, "523456789012345678"));
    expect(await response.json()).toMatchObject({ type: 4, data: { flags: 64 } });
    expect(callbacks.after).not.toHaveBeenCalled();
  });
  it("recusa assinatura inválida e replays antigos", async () => {
    const data = { custom_id: `gwu:quantity:${productId}`, component_type: 2 };
    expect((await POST(request(data, GW_UP_GUILD_ID, 0, "0".repeat(128)))).status).toBe(401);
    expect((await POST(request(data, GW_UP_GUILD_ID, 301))).status).toBe(401);
    expect(callbacks.after).not.toHaveBeenCalled();
  });
});
