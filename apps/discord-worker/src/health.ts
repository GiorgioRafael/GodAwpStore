import { createServer, type Server } from "node:http";

export type WorkerHealth = {
  ready: boolean;
  configuredGuildCount: number;
  trackedGuildCount: number;
  lastEventAt: string | null;
  lastError: string | null;
  startedAt: string;
};

export function startHealthServer(port: number, health: WorkerHealth): Server {
  return createServer((request, response) => {
    if (request.url !== "/" && request.url !== "/healthz") {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const healthy = health.ready
      && health.trackedGuildCount === health.configuredGuildCount
      && health.lastError === null;
    response.writeHead(healthy ? 200 : 503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      status: healthy ? "ok" : "degraded",
      ready: health.ready,
      configuredGuildCount: health.configuredGuildCount,
      trackedGuildCount: health.trackedGuildCount,
      lastEventAt: health.lastEventAt,
      lastError: health.lastError,
      startedAt: health.startedAt,
    }));
  }).listen(port, "0.0.0.0");
}
