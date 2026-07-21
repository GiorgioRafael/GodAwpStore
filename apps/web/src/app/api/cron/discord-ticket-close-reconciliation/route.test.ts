import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileDiscordTicketCloseClaims: vi.fn(),
  reconcileGiveaways: vi.fn(),
}));

vi.mock("@/lib/bot/discord-ticket-close-reconciliation", () => ({
  reconcileDiscordTicketCloseClaims: mocks.reconcileDiscordTicketCloseClaims,
}));

vi.mock("@/lib/giveaways/reconciliation", () => ({
  reconcileGiveaways: mocks.reconcileGiveaways,
}));

import { GET } from "./route";

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

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  mocks.reconcileDiscordTicketCloseClaims.mockResolvedValue(result);
  mocks.reconcileGiveaways.mockResolvedValue(giveawayResult);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Discord ticket close reconciliation cron", () => {
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
      expect(mocks.reconcileGiveaways).not.toHaveBeenCalled();
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
      giveaways: giveawayResult,
    });
    expect(mocks.reconcileDiscordTicketCloseClaims).toHaveBeenCalledOnce();
    expect(mocks.reconcileGiveaways).toHaveBeenCalledOnce();
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
  });
});
