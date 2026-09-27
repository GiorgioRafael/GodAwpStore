import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/brand", () => ({ IS_GWSTORE: true }));
vi.mock("@/lib/auth-identity", () => ({
  extractDiscordIdentity: (user: { id: string }) => ({ discordId: user.id }),
  extractGoogleIdentity: () => null,
  parseAdminDiscordIds: () => new Set(["admin"]),
  parseMasterAdminGoogleEmails: () => new Set(),
}));

import { proxy } from "./proxy";

describe("link de pagamento compartilhado com compradores", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
    mocks.getUser.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("leva visitante sem sessão do relatório ao formulário público", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await proxy(new NextRequest("https://gwstore.vercel.app/pagamentos-pix"));
    expect(response.headers.get("location")).toBe("https://gwstore.vercel.app/pagar");
  });

  it("leva comprador autenticado ao formulário público, sem liberar o painel", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "buyer" } } });
    const response = await proxy(new NextRequest("https://gwstore.vercel.app/pagamentos-pix"));
    expect(response.headers.get("location")).toBe("https://gwstore.vercel.app/pagar");

    const otherAdminPage = await proxy(new NextRequest("https://gwstore.vercel.app/pedidos"));
    expect(otherAdminPage.headers.get("location")).toBe("https://gwstore.vercel.app/acesso-negado");
  });

  it("mantém o relatório disponível para administradores", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    const response = await proxy(new NextRequest("https://gwstore.vercel.app/pagamentos-pix"));
    expect(response.headers.get("location")).toBeNull();
  });
});
