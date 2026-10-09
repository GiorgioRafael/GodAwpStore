import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isGwStoreRailwayBridgeEnabled } from "../src/lib/railway-bridge";

const webDirectory = fileURLToPath(new URL("..", import.meta.url));

// Keep the former npm postbuild commands and their order unchanged for stores
// still deployed on Vercel. The compatibility bridge must not publish the bot.
export const DEPLOYMENT_POSTBUILD_COMMANDS: readonly (readonly string[])[] = [
  ["--conditions=react-server", "--import", "tsx", "scripts/reconcile-robux-orders.ts", "--deployment"],
  ["scripts/register-discord-commands.mjs", "--deployment"],
  ["--conditions=react-server", "--import", "tsx", "scripts/run-discord-storefront-repair.mjs", "--deployment"],
  ["scripts/refresh-discord-brand-banners.mjs", "--deployment"],
  ["--conditions=react-server", "--import", "tsx", "scripts/refresh-discord-product-emojis.ts", "--deployment"],
  ["scripts/refresh-discord-product-option-emojis.mjs", "--deployment"],
  ["--conditions=react-server", "--import", "tsx", "scripts/sync-discord-top-spenders.ts", "--deployment"],
  ["--conditions=react-server", "--import", "tsx", "scripts/sync-discord-item-selling.ts", "--deployment"],
  ["--conditions=react-server", "--import", "tsx", "scripts/sync-discord-ticket-categories.ts", "--deployment"],
  ["--conditions=react-server", "--import", "tsx", "scripts/sync-discord-up-services.ts", "--deployment"],
];

function executeStep(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args], { cwd: webDirectory, env: process.env, stdio: "inherit" });
    child.once("error", () => reject(new Error("Could not start a deployment postbuild step.")));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Deployment postbuild step failed; remaining steps were not run."));
    });
  });
}

export async function runDeploymentPostbuild({
  execute = executeStep,
  logger = console,
}: {
  execute?: (args: readonly string[]) => Promise<void>;
  logger?: Pick<Console, "info">;
} = {}) {
  if (isGwStoreRailwayBridgeEnabled()) {
    logger.info("[postbuild] GWStore Railway bridge: Discord publication skipped.");
    return;
  }
  for (const args of DEPLOYMENT_POSTBUILD_COMMANDS) await execute(args);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runDeploymentPostbuild().catch(error => {
    console.error("[postbuild]", error instanceof Error ? error.message : "failed");
    process.exitCode = 1;
  });
}
