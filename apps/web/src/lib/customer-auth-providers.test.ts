// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), fetch: vi.fn(), brand: { isGwStore: true } }));
vi.mock("server-only", () => ({}));
vi.mock("./brand", () => ({ get IS_GWSTORE() { return mocks.brand.isGwStore; } }));
vi.mock("./env", () => ({ getSupabasePublicConfig: mocks.config }));

import { getCustomerAuthProviders } from "./customer-auth-providers";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GWSTORE_EMAIL_AUTH_ENABLED", "false");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.brand.isGwStore = true;
  mocks.config.mockReturnValue({ url: "https://gw-project.supabase.co", publishableKey: "public-key" });
  mocks.fetch.mockResolvedValue(Response.json({ external: { google: true, discord: true, email: false }, mailer_autoconfirm: false }));
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("métodos de acesso disponíveis da GWStore", () => {
  it("consulta settings no servidor com chave pública e sem cache de autorização", async () => {
    expect(await getCustomerAuthProviders()).toEqual({ google: true, discord: true, email: false });
    expect(mocks.fetch).toHaveBeenCalledWith(new URL("https://gw-project.supabase.co/auth/v1/settings"), {
      headers: { apikey: "public-key" }, cache: "no-store", signal: expect.any(AbortSignal),
    });
  });

  it("não anuncia email antes de confirmar entrega SMTP e confirmação obrigatória", async () => {
    mocks.fetch.mockImplementation(() => Promise.resolve(Response.json({ external: { email: true, google: false, discord: true }, mailer_autoconfirm: false })));
    expect((await getCustomerAuthProviders()).email).toBe(false);
    vi.stubEnv("GWSTORE_EMAIL_AUTH_ENABLED", "true");
    expect(await getCustomerAuthProviders()).toEqual({ google: false, discord: true, email: true });
    mocks.fetch.mockResolvedValue(Response.json({ external: { email: true }, mailer_autoconfirm: true }));
    expect((await getCustomerAuthProviders()).email).toBe(false);
  });

  it.each([null, {}, { external: null }, { external: { google: "true", discord: 1, email: true } }])("recusa settings incompleto ou malformado (%j)", async settings => {
    vi.stubEnv("GWSTORE_EMAIL_AUTH_ENABLED", "true");
    mocks.fetch.mockResolvedValue(Response.json(settings));
    expect(await getCustomerAuthProviders()).toEqual({ google: false, discord: false, email: false });
  });

  it("falha fechada quando settings responde erro ou excede o timeout", async () => {
    mocks.fetch.mockResolvedValue(new Response("private provider detail", { status: 503 }));
    expect(await getCustomerAuthProviders()).toEqual({ google: false, discord: false, email: false });
    mocks.fetch.mockRejectedValue(new Error("timeout private-key"));
    expect(await getCustomerAuthProviders()).toEqual({ google: false, discord: false, email: false });
  });

  it("não consulta nem altera autenticação da THStore ou de serviço sem configuração", async () => {
    mocks.brand.isGwStore = false;
    expect(await getCustomerAuthProviders()).toEqual({ google: false, discord: false, email: false });
    mocks.brand.isGwStore = true;
    mocks.config.mockReturnValue(null);
    expect(await getCustomerAuthProviders()).toEqual({ google: false, discord: false, email: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
