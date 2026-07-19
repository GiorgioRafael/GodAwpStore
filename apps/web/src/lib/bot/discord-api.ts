import "server-only";

const DISCORD_REQUEST_TIMEOUT_MS = 4_000;
const DISCORD_MAX_RETRY_AFTER_MS = 1_500;
const DISCORD_UNKNOWN_CHANNEL_CODE = 10_003;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly method: string,
    readonly discordCode: number | null,
  ) {
    super(`Discord recusou a operação (${status}).`);
    this.name = "DiscordApiError";
  }
}

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
    const payload: unknown = await response.clone().json().catch(() => null);
    throw new DiscordApiError(
      response.status,
      path,
      (init.method ?? "GET").toUpperCase(),
      readDiscordErrorCode(payload),
    );
  }
  return (await response.json()) as T;
}

export async function isDiscordUnknownChannelResponse(response: Response) {
  if (response.status !== 404) return false;
  const payload: unknown = await response.clone().json().catch(() => null);
  return readDiscordErrorCode(payload) === DISCORD_UNKNOWN_CHANNEL_CODE;
}

export async function assertConfiguredDiscordBotIdentity(
  fetcher: typeof fetch = fetch,
) {
  const configuredApplicationId = process.env.DISCORD_APPLICATION_ID?.trim() ?? "";
  if (!SNOWFLAKE_PATTERN.test(configuredApplicationId)) {
    throw new Error("DISCORD_APPLICATION_ID não configurado ou inválido.");
  }

  const botUser = await discordBotJson<{ id?: unknown; bot?: unknown }>(
    "/users/@me",
    {},
    fetcher,
  );
  if (
    typeof botUser.id !== "string" ||
    !SNOWFLAKE_PATTERN.test(botUser.id) ||
    botUser.id !== configuredApplicationId ||
    botUser.bot !== true
  ) {
    throw new Error("O bot autenticado não corresponde ao aplicativo Discord configurado.");
  }
  return botUser.id;
}

export async function assertDiscordBotGuildAccess(
  discordGuildId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!SNOWFLAKE_PATTERN.test(discordGuildId)) {
    throw new Error("ID do servidor Discord não configurado ou inválido.");
  }

  const guild: unknown = await discordBotJson(
    `/guilds/${discordGuildId}`,
    {},
    fetcher,
  );
  if (!isObject(guild) || guild.id !== discordGuildId) {
    throw new Error("Discord não confirmou o acesso do bot ao servidor configurado.");
  }
  return discordGuildId;
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

function readDiscordErrorCode(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("code" in payload)) {
    return null;
  }
  const code = (payload as { code?: unknown }).code;
  return typeof code === "number" && Number.isSafeInteger(code) ? code : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
