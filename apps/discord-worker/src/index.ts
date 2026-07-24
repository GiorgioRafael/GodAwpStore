import { loadConfig } from "./config.js";
import { startHealthServer, type WorkerHealth } from "./health.js";
import { DiscordInviteWorker } from "./worker.js";

const config = loadConfig();
const health: WorkerHealth = {
  ready: false,
  configuredGuildCount: config.discordGuildIds.length,
  trackedGuildCount: 0,
  lastEventAt: null,
  lastError: null,
  startedAt: new Date().toISOString(),
};
const healthServer = startHealthServer(config.port, health);
const worker = new DiscordInviteWorker(config, health);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event: "worker_shutdown",
    signal,
  }));
  health.ready = false;
  healthServer.close();
  await worker.stop();
  process.exitCode = 0;
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  health.lastError = error.message.slice(0, 500);
  console.error(error);
});
process.on("unhandledRejection", (error) => {
  health.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  console.error(error);
});

try {
  await worker.start();
} catch (error) {
  health.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  console.error(error);
  healthServer.close();
  process.exitCode = 1;
}
