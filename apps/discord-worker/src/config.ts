const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

export type WorkerConfig = {
  discordBotToken: string;
  discordGuildIds: string[];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  port: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const discordBotToken = required(environment.DISCORD_BOT_TOKEN, "DISCORD_BOT_TOKEN");
  const supabaseUrl = required(
    environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL,
    "SUPABASE_URL",
  );
  const supabaseServiceRoleKey = required(
    environment.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const guildIds = required(
    environment.DISCORD_GUILD_IDS ?? environment.DISCORD_GUILD_ID,
    "DISCORD_GUILD_IDS",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const discordGuildIds = [...new Set(guildIds)];
  if (!discordGuildIds.length || discordGuildIds.some((id) => !SNOWFLAKE_PATTERN.test(id))) {
    throw new Error("DISCORD_GUILD_IDS deve conter IDs válidos separados por vírgula.");
  }

  const rawPort = environment.PORT?.trim() || "3001";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT deve ser um número entre 1 e 65535.");
  }
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error();
    }
  } catch {
    throw new Error("SUPABASE_URL inválida.");
  }

  return {
    discordBotToken,
    discordGuildIds,
    supabaseUrl,
    supabaseServiceRoleKey,
    port,
  };
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} não configurada.`);
  return normalized;
}
