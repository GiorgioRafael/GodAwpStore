import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), complete: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/bot/discord-item-selling-server", () => ({ completeItemSellingInteraction: mocks.complete }));
import { POST } from "./route";
import { GWSTORE_SELLING_GUILD_ID, SELLING_OPEN_ID, SELLING_SUBMIT_ID } from "@/lib/bot/discord-item-selling";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("webhook de venda de itens", () => {
  it("valida a assinatura, abre o modal imediatamente e adia a criação do ticket", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ format: "der", type: "spki" });
    vi.stubEnv("DISCORD_PUBLIC_KEY", der.subarray(der.length - 32).toString("hex"));
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const payload = { type: 3, id: "223456789012345678", application_id: "123456789012345678",
      guild_id: GWSTORE_SELLING_GUILD_ID, channel_id: "323456789012345678", token: "abcdefghijklmnopqrstuvwxyz0123456789",
      member: { user: { id: "423456789012345678" } }, data: { custom_id: SELLING_OPEN_ID },
    };
    const request = (data: unknown, timestamp = String(Math.floor(Date.now() / 1000)), valid = true) => {
      const body = JSON.stringify(data);
      return new Request("https://gwstore.vercel.app/api/webhooks/discord", { method: "POST", body,
        headers: { "x-signature-timestamp": timestamp,
          "x-signature-ed25519": valid ? sign(null, Buffer.from(timestamp + body), privateKey).toString("hex") : "0".repeat(128) } });
    };
    expect((await POST(request(payload, undefined, false))).status).toBe(401);
    expect(mocks.after).not.toHaveBeenCalled();
    const response = await POST(request(payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ type: 9, data: { custom_id: SELLING_SUBMIT_ID } });
    expect(mocks.after).not.toHaveBeenCalled();
    const submission = { ...payload, type: 5, data: { custom_id: SELLING_SUBMIT_ID,
      components: [{ component: { custom_id: "item_name", value: "Dragon" } }] } };
    await expect((await POST(request(submission))).json()).resolves.toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    await mocks.after.mock.calls[0][0]();
    expect(mocks.complete).toHaveBeenCalledWith(submission);
    expect((await POST(request(submission, String(Math.floor(Date.now() / 1000) - 3600)))).status).toBe(401);
  });
});
