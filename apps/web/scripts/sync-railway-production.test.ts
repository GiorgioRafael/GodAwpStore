// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { railwayProductionSyncCommands, runRailwayProductionSync } from "./sync-railway-production.mjs";

const env = { NODE_ENV: "production", NEXT_PUBLIC_STORE_NAME: "GWStore", DISCORD_GUILD_ID: "1401264061101899820" };

describe("explicit Railway production sync", () => {
  it("requires an explicit confirmation, production brand and exact GW guild", () => {
    expect(() => railwayProductionSyncCommands([], env)).toThrow(/confirm-production/);
    for (const changed of [{ NODE_ENV: "development" }, { NEXT_PUBLIC_STORE_NAME: "THStore" }, { DISCORD_GUILD_ID: "" }, { DISCORD_GUILD_ID: "999999999999999999" }]) {
      expect(() => railwayProductionSyncCommands(["--confirm-production"], { ...env, ...changed })).toThrow();
    }
  });

  it("runs manual commands without changing Vercel platform variables", async () => {
    const execute = vi.fn(async () => undefined);
    const configured = { ...env, VERCEL_ENV: "preview" };
    await runRailwayProductionSync({ argv: ["--confirm-production"], env: configured, execute });
    expect(execute).toHaveBeenCalledTimes(10);
    expect(execute.mock.calls[0]).toEqual([
      ["--conditions=react-server", "--import", "tsx", "scripts/reconcile-robux-orders.ts", "--railway-production-sync"], configured,
    ]);
    expect(execute.mock.calls.flat(2)).not.toContain("--deployment");
    expect(configured.VERCEL_ENV).toBe("preview");
  });

  it("stops immediately after a failed step so a partially failed sync is visible", async () => {
    const execute = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("step failed"));
    await expect(runRailwayProductionSync({ argv: ["--confirm-production"], env, execute })).rejects.toThrow("step failed");
    expect(execute).toHaveBeenCalledOnce();
  });
});
