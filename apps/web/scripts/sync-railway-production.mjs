import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertGwStoreProduction } from "./railway-scheduler.mjs";

const webDirectory = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const typedNodeArgs = ["--conditions=react-server", "--import", "tsx"];

/**
 * Separate from build/start: run explicitly after production traffic has moved.
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 */
export function railwayProductionSyncCommands(argv = process.argv.slice(2), env = process.env) {
  if (!argv.includes("--confirm-production")) {
    throw new Error("Explicit --confirm-production is required after GWStore cutover.");
  }
  assertGwStoreProduction(env);
  if (env.DISCORD_GUILD_ID?.trim() !== "1401264061101899820") {
    throw new Error("The GWStore Discord guild must be explicitly configured for production sync.");
  }
  return [
    [...typedNodeArgs, "scripts/reconcile-robux-orders.ts", "--railway-production-sync"],
    ["scripts/register-discord-commands.mjs"],
    [...typedNodeArgs, "scripts/run-discord-storefront-repair.mjs"],
    ["scripts/refresh-discord-brand-banners.mjs"],
    [...typedNodeArgs, "scripts/refresh-discord-product-emojis.ts"],
    ["scripts/refresh-discord-product-option-emojis.mjs"],
    [...typedNodeArgs, "scripts/sync-discord-top-spenders.ts"],
    [...typedNodeArgs, "scripts/sync-discord-item-selling.ts"],
    [...typedNodeArgs, "scripts/sync-discord-ticket-categories.ts"],
    [...typedNodeArgs, "scripts/sync-discord-up-services.ts"],
  ];
}

function runStep(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: webDirectory, env, stdio: "inherit", timeout: 600_000, killSignal: "SIGTERM",
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    function cleanUp() {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
    child.once("error", () => { cleanUp(); reject(new Error("Could not start a production sync step.")); });
    child.once("exit", (code) => {
      cleanUp();
      if (code === 0) resolve();
      else reject(new Error("Production sync step failed; inspect its log and retry the command."));
    });
  });
}

/** @param {{ argv?: string[], env?: Record<string, string | undefined>,
 * execute?: (args: string[], env: Record<string, string | undefined>) => Promise<unknown> }} [options] */
export async function runRailwayProductionSync({ argv = process.argv.slice(2), env = process.env, execute = runStep } = {}) {
  const commands = railwayProductionSyncCommands(argv, env);
  // Some Railway runtime images prune build-only dependencies. Fail before any
  // Discord mutation and run from a full checkout with the service's env instead.
  require.resolve("tsx");
  require.resolve("esbuild");
  for (const args of commands) await execute(args, env);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runRailwayProductionSync().catch(error => {
    console.error("[railway:sync]", error instanceof Error ? error.message : "failed");
    process.exitCode = 1;
  });
}
