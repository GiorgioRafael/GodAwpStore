import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/eclipsepay/reconciliation", () => ({ reconcileEclipsePayments: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }) }));
vi.mock("@/lib/eclipsepay/payment-link-reconciliation", () => ({ reconcileEclipsePaymentLinks: vi.fn().mockResolvedValue({ processed: 0, failed: 0 }) }));

const mocks = vi.hoisted(() => ({
  brand: { IS_GWSTORE: true },
  reconcileDiscordTicketCloseClaims: vi.fn(),
  reconcileDeliveredDiscordTicketAutoCloses: vi.fn(),
  reconcileGiveaways: vi.fn(),
  reconcileLeadRecoveryOffers: vi.fn(),
  reconcileRouletteRedemptionTickets: vi.fn(),
  reconcileLatePaidOrderTickets: vi.fn(),
  reconcilePaidOrderTickets: vi.fn(),
  reconcileRobuxOrders: vi.fn(),
  reconcileRobuxCustomerRankRoles: vi.fn(),
  synchronizeGwStoreTopSpenders: vi.fn(),
}));
vi.mock("@/lib/brand", () => mocks.brand);

vi.mock("@/lib/bot/discord-top-spenders", () => ({
  synchronizeGwStoreTopSpenders: mocks.synchronizeGwStoreTopSpenders,
}));

vi.mock("@/lib/bot/discord-ticket-close-reconciliation", () => ({
  reconcileDiscordTicketCloseClaims: mocks.reconcileDiscordTicketCloseClaims,
}));

vi.mock("@/lib/bot/discord-ticket-auto-close", () => ({
  reconcileDeliveredDiscordTicketAutoCloses:
    mocks.reconcileDeliveredDiscordTicketAutoCloses,
}));

vi.mock("@/lib/giveaways/reconciliation", () => ({
  reconcileGiveaways: mocks.reconcileGiveaways,
}));

vi.mock("@/lib/bot/lead-recovery", () => ({
  reconcileLeadRecoveryOffers: mocks.reconcileLeadRecoveryOffers,
}));

vi.mock("@/lib/bot/late-payment-ticket", () => ({
  reconcileLatePaidOrderTickets: mocks.reconcileLatePaidOrderTickets,
}));
vi.mock("@/lib/payments/paid-ticket-reconciliation", () => ({
  reconcilePaidOrderTickets: mocks.reconcilePaidOrderTickets,
}));
vi.mock("@/lib/roulette/redemptions", () => ({
  reconcileRouletteRedemptionTickets: mocks.reconcileRouletteRedemptionTickets,
}));

import { GET } from "./route";

vi.mock("@/lib/robux/reconciliation", () => ({ reconcileRobuxOrders: mocks.reconcileRobuxOrders }));
vi.mock("@/lib/robux/customer-rank-role-sync", () => ({ reconcileRobuxCustomerRankRoles: mocks.reconcileRobuxCustomerRankRoles }));

const result = {
  scanned: 2,
  completed: 1,
  alreadyClosed: 0,
  resumed: 1,
  superseded: 0,
  active: 0,
  failed: 0,
};

const giveawayResult = {
  activated: 1,
  referralsChecked: 3,
  referralsValidated: 2,
  referralsInvalidated: 1,
  drawsCompleted: 1,
  drawsWithoutWinner: 0,
  drawsDeferred: 0,
  ticketsOpened: 1,
  failures: 0,
};

const deliveredTicketAutoCloseResult = {
  claimed: 1,
  completed: 1,
  alreadyClosed: 0,
  removed: 1,
  superseded: 0,
  failed: 0,
};

const leadRecoveryResult = {
  claimed: 2,
  sent: 1,
  failed: 1,
};

const rouletteRedemptionResult = { attempted: 1, opened: 1, failed: 0 };

// Compradores que pagaram depois do prazo e ficaram sem canal para perguntar.
const latePaymentResult = { pending: 2, opened: 2, failed: 0 };
const paidOrderResult = { checked: 1, opened: 1, skipped: 0, failed: 0, deferred: 0 };

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  mocks.brand.IS_GWSTORE = true;
  mocks.reconcileDiscordTicketCloseClaims.mockResolvedValue(result);
  mocks.reconcileDeliveredDiscordTicketAutoCloses.mockResolvedValue(
    deliveredTicketAutoCloseResult,
  );
  mocks.reconcileGiveaways.mockResolvedValue(giveawayResult);
  mocks.reconcileLeadRecoveryOffers.mockResolvedValue(leadRecoveryResult);
  mocks.reconcileRouletteRedemptionTickets.mockResolvedValue(rouletteRedemptionResult);
  mocks.reconcileLatePaidOrderTickets.mockResolvedValue(latePaymentResult);
  mocks.reconcilePaidOrderTickets.mockResolvedValue(paidOrderResult);
  mocks.reconcileRobuxOrders.mockResolvedValue({ checked: 2, opened: 2, pending: 0, skipped: 0, failed: 0 });
  mocks.reconcileRobuxCustomerRankRoles.mockResolvedValue({ checked: 2, synced: 2, failed: 0 });
  mocks.synchronizeGwStoreTopSpenders.mockResolvedValue({ status: "updated", customers: 5 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Discord ticket close reconciliation cron", () => {
  it("autentica antes de retornar noop sem iniciar as filas da Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
    const url = "https://gwstore.vercel.app/api/cron/discord-ticket-close-reconciliation";
    expect((await GET(new Request(url))).status).toBe(401);
    const response = await GET(new Request(url, { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, status: "railway-managed" });
    for (const mock of Object.values(mocks)) {
      if (typeof mock === "function") expect(mock).not.toHaveBeenCalled();
    }
  });

  it.each(["outside-vercel", "railway", "invalid-origin", "thstore"])("preserva as filas com %s", async mode => {
    vi.stubEnv("VERCEL", mode === "outside-vercel" ? "" : "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", mode === "invalid-origin"
      ? "https://other-store.up.railway.app" : "https://gwstore-web-production.up.railway.app");
    if (mode === "railway") vi.stubEnv("RAILWAY_SERVICE_ID", "railway-service");
    if (mode === "thstore") mocks.brand.IS_GWSTORE = false;
    const response = await GET(new Request("https://gwstore.vercel.app/api/cron/discord-ticket-close-reconciliation",
      { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(response.status).toBe(200);
    expect(mocks.reconcileDiscordTicketCloseClaims).toHaveBeenCalledOnce();
    expect(mocks.reconcilePaidOrderTickets).toHaveBeenCalledOnce();
  });

  it.each([undefined, "Bearer wrong-secret", "cron-secret-value"])(
    "rejeita Authorization invalido: %s",
    async (authorization) => {
      const headers = authorization ? { authorization } : undefined;
      const response = await GET(
        new Request(
          "https://gwstore.vercel.app/api/cron/discord-ticket-close-reconciliation",
          { headers },
        ),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.reconcileDiscordTicketCloseClaims).not.toHaveBeenCalled();
      expect(mocks.reconcileDeliveredDiscordTicketAutoCloses).not.toHaveBeenCalled();
      expect(mocks.reconcileGiveaways).not.toHaveBeenCalled();
      expect(mocks.reconcileLeadRecoveryOffers).not.toHaveBeenCalled();
      expect(mocks.reconcileLatePaidOrderTickets).not.toHaveBeenCalled();
      expect(mocks.reconcilePaidOrderTickets).not.toHaveBeenCalled();
      expect(mocks.synchronizeGwStoreTopSpenders).not.toHaveBeenCalled();
    },
  );

  it("executa com Bearer CRON_SECRET e retorna apenas contadores", async () => {
    const response = await GET(
      new Request(
        "https://gwstore.vercel.app/api/cron/discord-ticket-close-reconciliation",
        { headers: { authorization: "Bearer cron-secret-value" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      tickets: result,
      deliveredTicketAutoClose: deliveredTicketAutoCloseResult,
      giveaways: giveawayResult,
      leadRecovery: leadRecoveryResult,
      rouletteRedemptions: rouletteRedemptionResult,
      latePayments: latePaymentResult,
      paidOrders: paidOrderResult,
      robux: { checked: 2, opened: 2, pending: 0, skipped: 0, failed: 0 },
      robuxRanks: { checked: 2, synced: 2, failed: 0 },
      eclipsepay: { processed: 0, failed: 0 },
      eclipsepayLinks: { processed: 0, failed: 0 },
    });
    expect(mocks.reconcileDiscordTicketCloseClaims).toHaveBeenCalledOnce();
    expect(mocks.reconcileDeliveredDiscordTicketAutoCloses).toHaveBeenCalledOnce();
    expect(mocks.reconcileGiveaways).toHaveBeenCalledOnce();
    expect(mocks.reconcileLeadRecoveryOffers).toHaveBeenCalledOnce();
    // A cada cinco minutos, ninguém que pagou fica sem canal.
    expect(mocks.reconcileLatePaidOrderTickets).toHaveBeenCalledOnce();
    expect(mocks.reconcilePaidOrderTickets).toHaveBeenCalledOnce();
    // O Top 5 tem seu próprio agendamento de três horas.
    expect(mocks.synchronizeGwStoreTopSpenders).not.toHaveBeenCalled();
  });

  it("retorna 503 sem expor detalhes internos quando o job falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.reconcileDiscordTicketCloseClaims.mockRejectedValue(
      new Error("service role secret leaked here"),
    );

    const response = await GET(
      new Request(
        "https://gwstore.vercel.app/api/cron/discord-ticket-close-reconciliation",
        { headers: { authorization: "Bearer cron-secret-value" } },
      ),
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("temporariamente indisponível");
    expect(body).not.toContain("service role secret");
    expect(consoleError).toHaveBeenCalled();
    expect(mocks.reconcilePaidOrderTickets).toHaveBeenCalledOnce();
  });
});
