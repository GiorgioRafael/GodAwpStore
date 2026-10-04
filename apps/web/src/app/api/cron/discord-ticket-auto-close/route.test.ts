import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  brand: { IS_GWSTORE: true },
  claims: vi.fn(),
  delivered: vi.fn(),
  selling: vi.fn(),
}));
vi.mock("@/lib/brand", () => mocks.brand);
vi.mock("@/lib/bot/discord-ticket-auto-close", () => ({ reconcileDeliveredDiscordTicketAutoCloses: mocks.delivered }));
vi.mock("@/lib/bot/discord-ticket-close-reconciliation", () => ({ reconcileDiscordTicketCloseClaims: mocks.claims }));
vi.mock("@/lib/bot/discord-item-selling-server", () => ({ reconcileCompletedGwStoreItemSellingTickets: mocks.selling }));

import { GET } from "./route";

const request = (authorization = "Bearer cron-secret") => new Request(
  "https://gwstore.vercel.app/api/cron/discord-ticket-auto-close", { headers: { authorization } },
);
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  mocks.brand.IS_GWSTORE = true;
  mocks.claims.mockResolvedValue({ completed: 0, failed: 0 });
  mocks.delivered.mockResolvedValue({ completed: 0, failed: 0 });
  mocks.selling.mockResolvedValue({ scanned: 0, completed: 0, alreadyClosed: 0, active: 0, failed: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("fechamento automático de compras e vendas da GWStore", () => {
  it("recusa requisições sem segredo válido antes de acessar tickets", async () => {
    expect((await GET(request("Bearer wrong-secret"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(401);
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.delivered).not.toHaveBeenCalled();
    expect(mocks.selling).not.toHaveBeenCalled();
  });
  it("não executa na THStore", async () => {
    mocks.brand.IS_GWSTORE = false;
    const response = await GET(request());
    await expect(response.json()).resolves.toEqual({ ok: true, status: "disabled" });
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.delivered).not.toHaveBeenCalled();
    expect(mocks.selling).not.toHaveBeenCalled();
  });
  it("executa as filas de compras e vendas e retorna contadores sem cache", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, tickets: { completed: 0, failed: 0 }, deliveredTicketAutoClose: { completed: 0, failed: 0 }, itemSellingTicketAutoClose: { scanned: 0, completed: 0, alreadyClosed: 0, active: 0, failed: 0 } });
    expect(mocks.claims).toHaveBeenCalledOnce();
    expect(mocks.delivered).toHaveBeenCalledOnce();
    expect(mocks.selling).toHaveBeenCalledOnce();
    expect(mocks.claims).toHaveBeenCalledWith({ gwStoreOnly: true });
    expect(mocks.delivered).toHaveBeenCalledWith({ gwStoreOnly: true });
  });
  it("mantém a outra fila rodando e não expõe erros internos quando uma falha", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claims.mockRejectedValue(new Error("private error details"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.delivered).toHaveBeenCalledOnce();
    expect(mocks.selling).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain("private error");
    errorLog.mockRestore();
  });
  it.each(["delivered", "selling"] as const)("sinaliza falhas individuais da fila %s mesmo quando ela resolve", async queue => {
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks[queue].mockResolvedValue({ completed: 0, failed: 1 });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
    infoLog.mockRestore();
  });
});
