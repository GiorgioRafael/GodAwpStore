// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ gw: true }));
vi.mock("../src/lib/brand", () => ({ get IS_GWSTORE() { return brand.gw; } }));
import { runDeploymentPostbuild } from "./run-deployment-postbuild";

const logger = { info: vi.fn() };
// Immutable compatibility baseline: preserve the old npm lifecycle, not merely
// the set of scripts (their deployment args and Node conditions matter too).
const oldPostbuild = "node --conditions=react-server --import tsx scripts/reconcile-robux-orders.ts --deployment && node scripts/register-discord-commands.mjs --deployment && node --conditions=react-server --import tsx scripts/run-discord-storefront-repair.mjs --deployment && node scripts/refresh-discord-brand-banners.mjs --deployment && node --conditions=react-server --import tsx scripts/refresh-discord-product-emojis.ts --deployment && node scripts/refresh-discord-product-option-emojis.mjs --deployment && node --conditions=react-server --import tsx scripts/sync-discord-top-spenders.ts --deployment && node --conditions=react-server --import tsx scripts/sync-discord-item-selling.ts --deployment && node --conditions=react-server --import tsx scripts/sync-discord-ticket-categories.ts --deployment && node --conditions=react-server --import tsx scripts/sync-discord-up-services.ts --deployment";

beforeEach(() => {
  brand.gw = true;
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("deployment postbuild during Railway migration", () => {
  it("does not publish Discord from a valid GWStore Vercel bridge", async () => {
    const execute = vi.fn<(args: readonly string[]) => Promise<void>>(async () => undefined);
    await runDeploymentPostbuild({ execute, logger });
    expect(execute).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Discord publication skipped"));
  });

  it.each([
    "", "https://unrelated.up.railway.app", "http://origin.gwstoreofc.com",
    "https://origin.gwstoreofc.com/path", "https://origin.gwstoreofc.com?redirect=1",
  ])("preserves the exact original commands for an invalid or absent bridge: %s", async origin => {
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", origin);
    const execute = vi.fn<(args: readonly string[]) => Promise<void>>(async () => undefined);
    await runDeploymentPostbuild({ execute, logger });
    expect(execute.mock.calls.map(([args]) => ["node", ...args].join(" ")).join(" && ")).toBe(oldPostbuild);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(["THStore", "non-Vercel", "Railway"])("preserves the legacy pipeline for %s", async environment => {
    if (environment === "THStore") brand.gw = false;
    if (environment === "non-Vercel") vi.stubEnv("VERCEL", "");
    if (environment === "Railway") vi.stubEnv("RAILWAY_SERVICE_ID", "gw-web-service-id");
    const execute = vi.fn<(args: readonly string[]) => Promise<void>>(async () => undefined);
    await runDeploymentPostbuild({ execute, logger });
    expect(execute.mock.calls.map(([args]) => ["node", ...args].join(" ")).join(" && ")).toBe(oldPostbuild);
  });

  it("awaits each step before launching the next publication", async () => {
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "");
    let release: () => void = () => undefined;
    const execute = vi.fn<(args: readonly string[]) => Promise<void>>(async () => undefined)
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const running = runDeploymentPostbuild({ execute, logger });
    expect(execute).toHaveBeenCalledOnce();
    release();
    await running;
    expect(execute).toHaveBeenCalledTimes(10);
  });

  it("stops after the first failed step, as the former shell && chain did", async () => {
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "");
    const execute = vi.fn<(args: readonly string[]) => Promise<void>>(async () => undefined)
      .mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("failed step"));
    await expect(runDeploymentPostbuild({ execute, logger })).rejects.toThrow("failed step");
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[2][0]).toEqual([
      "--conditions=react-server", "--import", "tsx", "scripts/run-discord-storefront-repair.mjs", "--deployment",
    ]);
  });
});
