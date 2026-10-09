import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const synchronize = vi.hoisted(() => vi.fn());
const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("@/lib/brand", () => brand);
vi.mock("@/lib/bot/discord-top-spenders", () => ({
  synchronizeGwStoreTopSpenders: synchronize,
}));

import { GET } from "./route";

const request = (authorization?: string) => new Request(
  "https://gwstore.vercel.app/api/cron/discord-top-spenders",
  { headers: authorization ? { authorization } : undefined },
);

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret-value");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  brand.IS_GWSTORE = true;
  synchronize.mockResolvedValue({ status: "updated", customers: 5, messageId: "1556059887920873628" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Top 5 cron", () => {
  it("exige o segredo antes de pausar a publicação da Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
    expect((await GET(request("Bearer wrong-secret"))).status).toBe(401);
    const response = await GET(request("Bearer cron-secret-value"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, status: "railway-managed" });
    expect(synchronize).not.toHaveBeenCalled();
  });

  it.each(["outside-vercel", "railway", "invalid-origin", "thstore"])("preserva a execução com %s", async mode => {
    vi.stubEnv("VERCEL", mode === "outside-vercel" ? "" : "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", mode === "invalid-origin"
      ? "https://other-store.up.railway.app" : "https://gwstore-web-production.up.railway.app");
    if (mode === "railway") vi.stubEnv("RAILWAY_SERVICE_ID", "railway-service");
    if (mode === "thstore") brand.IS_GWSTORE = false;
    expect((await GET(request("Bearer cron-secret-value"))).status).toBe(200);
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it.each([undefined, "Bearer wrong-secret", "cron-secret-value"])(
    "não publica com autorização inválida: %s", async (authorization) => {
      const response = await GET(request(authorization));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(synchronize).not.toHaveBeenCalled();
    },
  );

  it("não publica quando o segredo não está configurado", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect(synchronize).not.toHaveBeenCalled();
  });

  it("atualiza a mensagem com o segredo correto", async () => {
    const response = await GET(request("Bearer cron-secret-value"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      topSpenders: { status: "updated", customers: 5, messageId: "1556059887920873628" },
    });
    expect(synchronize).toHaveBeenCalledOnce();
  });

  it("retorna falha sem expor detalhes internos", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    synchronize.mockRejectedValue(new Error("private database details"));
    const response = await GET(request("Bearer cron-secret-value"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false, error: "Ranking temporariamente indisponível.",
    });
  });
});
