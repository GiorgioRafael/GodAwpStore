import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), adminSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/auth", () => ({ getAdminSession: mocks.adminSession }));
import { requireShopActor, requireShopRequest } from "./request";
const origin = "https://gwstoreofc.com";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ADMIN_DISCORD_IDS", ""); });
afterEach(() => vi.unstubAllEnvs());
describe("origem e sessão da loja", () => {
  it("exige origem same-origin em mutações", () => {
    expect(requireShopRequest(new Request(`${origin}/api/loja/checkout`, { headers: { origin, "sec-fetch-site": "same-origin" } }), true)).toBe(origin);
    for (const headers of [{}, { origin: "https://evil.example" }, { origin, "sec-fetch-site": "cross-site" }])
      expect(() => requireShopRequest(new Request(`${origin}/api/loja/checkout`, { headers }), true)).toThrow();
  });
  it.each(["https://101master.vercel.app", "https://thstore.vercel.app", "https://gwstoreofc.com.evil.example", "http://gwstoreofc.com"])("rejeita host %s", value => {
    expect(() => requireShopRequest(new Request(`${value}/api/loja/checkout`, { headers: { origin: value } }), true)).toThrow();
  });
  it("não confia em metadata do cliente ou conta Google como identidade Discord", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user", user_metadata: { discord_id: "234486394414825472" }, identities: [{ provider: "google", identity_data: { sub: "234486394414825472" } }] } }, error: null });
    await expect(requireShopActor()).rejects.toMatchObject({ code: "unauthenticated" });
    expect(mocks.adminSession).not.toHaveBeenCalled();
  });
  it("compra exige sessão verificada e não exige entrar na guild", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user", identities: [{ provider: "discord", identity_data: { sub: "423456789012345678", full_name: "Cliente" } }] } }, error: null });
    expect(await requireShopActor()).toMatchObject({ authUserId: "user", discordId: "423456789012345678", isAdmin: false });
    expect(mocks.adminSession).not.toHaveBeenCalled();
    await expect(requireShopActor(true)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("admin depende da sessão validada do servidor com authID igual", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "staff", identities: [{ provider: "discord", identity_data: { sub: "234486394414825472" } }] } }, error: null });
    mocks.adminSession.mockResolvedValue({ status: "authorized", identity: { authUserId: "other" } });
    await expect(requireShopActor(true)).rejects.toMatchObject({ code: "forbidden" });
    mocks.adminSession.mockResolvedValue({ status: "authorized", identity: { authUserId: "staff" } });
    expect(await requireShopActor(true)).toMatchObject({ isAdmin: true, authUserId: "staff" });
  });
});
