import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShopError } from "@/lib/shop/errors";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), checkout: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/shop/request", () => ({ requireShopRequest: vi.fn(), requireShopActor: mocks.actor }));
vi.mock("@/lib/shop/checkout", () => ({ createShopCheckout: mocks.checkout }));
import { POST } from "./route";

const body = { requestId: "10000000-0000-4000-8000-000000000001", items: [], gameNickname: "Buyer_123" };
const request = () => new Request("https://gwstoreofc.com/api/loja/checkout", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => vi.resetAllMocks());

describe("login obrigatório antes de criar um pedido", () => {
  it("não cria pedido nem cobrança sem uma sessão Discord válida", async () => {
    mocks.actor.mockRejectedValue(new ShopError("unauthenticated"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "unauthenticated" } });
    expect(mocks.checkout).not.toHaveBeenCalled();
  });

  it("encaminha a identidade verificada no servidor para o checkout", async () => {
    const actor = { authUserId: "verified-user", discordId: "423456789012345678", isAdmin: false };
    mocks.actor.mockResolvedValue(actor);
    mocks.checkout.mockResolvedValue({ orderId: "saved-order" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.checkout).toHaveBeenCalledWith(body, actor);
  });
});
