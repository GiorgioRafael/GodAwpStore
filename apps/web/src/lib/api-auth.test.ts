import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSession = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getAdminSession }));

import { authorizeAdminRequest } from "@/lib/api-auth";

const identity = {
  authUserId: "27c79dc1-17ee-4738-aa3f-ea8489711d1d",
  discordId: "123456789012345678",
  displayName: "Administrador",
  avatarUrl: null,
};

describe("authorizeAdminRequest", () => {
  beforeEach(() => getAdminSession.mockReset());

  it.each([
    ["unconfigured", 503],
    ["error", 503],
    ["unauthenticated", 401],
    ["unauthorized", 403],
  ] as const)("responde sem acesso para sessão %s", async (status, responseStatus) => {
    getAdminSession.mockResolvedValue({
      status,
      identity: status === "unauthorized" ? identity : null,
    });

    const authorization = await authorizeAdminRequest();
    expect(authorization.ok).toBe(false);
    if (authorization.ok) throw new Error("A autorização deveria ter sido negada.");
    expect(authorization.response.status).toBe(responseStatus);
    expect(authorization.response.headers.get("content-type")).toContain("application/json");
  });

  it("entrega a identidade validada às rotas administrativas", async () => {
    getAdminSession.mockResolvedValue({ status: "authorized", identity });

    await expect(authorizeAdminRequest()).resolves.toEqual({ ok: true, identity });
  });
});
