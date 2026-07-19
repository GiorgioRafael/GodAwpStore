import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  synchronizeAllOpenDiscordTicketControls: vi.fn(),
}));

vi.mock("@/lib/bot/discord-ticket-controls-sync", () => ({
  synchronizeAllOpenDiscordTicketControls:
    mocks.synchronizeAllOpenDiscordTicketControls,
}));

import * as route from "./route";

const syncResult = {
  processed: 12,
  synchronized: 11,
  missingChannelsClosed: 1,
  failed: 1,
  permissionsUpdated: 10,
  welcomeMessagesUpdated: 9,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "internal-sync-secret");
  mocks.synchronizeAllOpenDiscordTicketControls.mockResolvedValue(syncResult);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("internal Discord ticket controls sync", () => {
  it("falha fechado com 401 quando CRON_SECRET não está configurado", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const response = await route.POST(
      requestWithAuthorization("Bearer internal-sync-secret"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.synchronizeAllOpenDiscordTicketControls).not.toHaveBeenCalled();
  });

  it("retorna 401 quando o Bearer não corresponde exatamente ao segredo", async () => {
    const response = await route.POST(
      requestWithAuthorization("Bearer wrong-secret"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.synchronizeAllOpenDiscordTicketControls).not.toHaveBeenCalled();
  });

  it("executa com o Bearer correto e retorna os contadores da sincronização", async () => {
    const response = await route.POST(
      requestWithAuthorization("Bearer internal-sync-secret"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, ...syncResult });
    expect(mocks.synchronizeAllOpenDiscordTicketControls).toHaveBeenCalledOnce();
  });

  it("retorna 503 sem expor detalhes internos quando a sincronização falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.synchronizeAllOpenDiscordTicketControls.mockRejectedValue(
      new Error("DISCORD_BOT_TOKEN=never-expose-this"),
    );

    const response = await route.POST(
      requestWithAuthorization("Bearer internal-sync-secret"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("temporariamente indisponível");
    expect(body).not.toContain("never-expose-this");
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it("expõe apenas POST e a configuração dinâmica do runtime Node.js", () => {
    expect(route).not.toHaveProperty("GET");
    expect(route).not.toHaveProperty("PUT");
    expect(route).not.toHaveProperty("DELETE");
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(60);
  });
});

function requestWithAuthorization(authorization?: string) {
  return new Request(
    "https://gwstore.vercel.app/api/internal/discord-ticket-controls-sync",
    {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
    },
  );
}
