import "server-only";

const DISCORD_REQUEST_TIMEOUT_MS = 4_000;
const DISCORD_MAX_RETRY_AFTER_MS = 1_500;

export async function discordBotRequest(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  attempt = 0,
): Promise<Response> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN não configurado.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetcher(`${discordApiUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429 && attempt === 0) {
    const payload: unknown = await response.clone().json().catch(() => null);
    const retryAfter = readRetryAfterMs(payload);
    if (retryAfter !== null && retryAfter <= DISCORD_MAX_RETRY_AFTER_MS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      return discordBotRequest(path, init, fetcher, attempt + 1);
    }
  }

  return response;
}

export async function discordBotJson<T>(
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await discordBotRequest(path, init, fetcher);
  if (!response.ok) {
    throw new Error(`Discord recusou a operação (${response.status}).`);
  }
  return (await response.json()) as T;
}

export function discordApiUrl() {
  return (process.env.DISCORD_API_URL?.trim() || "https://discord.com/api/v10").replace(
    /\/$/,
    "",
  );
}

function readRetryAfterMs(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("retry_after" in payload)) {
    return null;
  }
  const seconds = (payload as { retry_after?: unknown }).retry_after;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1_000)
    : null;
}
