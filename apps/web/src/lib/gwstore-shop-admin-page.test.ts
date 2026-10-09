import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gw: true,
  getAdminSession: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("./brand", () => ({ get IS_GWSTORE() { return mocks.gw; } }));
vi.mock("./auth", () => ({ getAdminSession: mocks.getAdminSession }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

import { requireGwStoreShopAdminPage } from "./gwstore-shop-admin-page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gw = true;
});

describe("gate das páginas privadas de atendimento web", () => {
  it.each([
    ["unauthenticated", "/login?next=%2Fadmin%2Fatendimento-loja"],
    ["unconfigured", "/login?next=%2Fadmin%2Fatendimento-loja&setup=1"],
    ["error", "/login?next=%2Fadmin%2Fatendimento-loja&erro=configuracao"],
    ["unauthorized", "/acesso-negado"],
  ])("interrompe render antes de carregar dados com sessão %s", async (status, target) => {
    mocks.getAdminSession.mockResolvedValue({ status, identity: null });
    await expect(requireGwStoreShopAdminPage("/admin/atendimento-loja")).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(target);
  });

  it("aceita exclusivamente a identidade administrativa validada", async () => {
    const identity = { authUserId: "admin-auth", discordId: "admin" };
    mocks.getAdminSession.mockResolvedValue({ status: "authorized", identity });
    await expect(requireGwStoreShopAdminPage("/admin/atendimento-loja")).resolves.toBe(identity);
    expect(mocks.getAdminSession).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("não disponibiliza a nova área da GW na THStore", async () => {
    mocks.gw = false;
    await expect(requireGwStoreShopAdminPage("/atendimento-loja")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getAdminSession).not.toHaveBeenCalled();
  });
});
