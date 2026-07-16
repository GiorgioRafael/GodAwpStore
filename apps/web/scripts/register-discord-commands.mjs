import { discordCommands } from "./discord-command-definitions.js";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();

if (!applicationId || !SNOWFLAKE_PATTERN.test(applicationId)) {
  throw new Error("DISCORD_APPLICATION_ID ausente ou inválido.");
}
if (!botToken) {
  throw new Error("DISCORD_BOT_TOKEN ausente.");
}
if (guildId && !SNOWFLAKE_PATTERN.test(guildId)) {
  throw new Error("DISCORD_GUILD_ID inválido.");
}

const apiBase = "https://discord.com/api/v10";
const endpoint = guildId
  ? `${apiBase}/applications/${applicationId}/guilds/${guildId}/commands`
  : `${apiBase}/applications/${applicationId}/commands`;
const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(discordCommands),
});

if (!response.ok) {
  const requestId = response.headers.get("x-ratelimit-bucket") ?? "sem identificador";
  throw new Error(`Discord recusou o registro (${response.status}; ${requestId}).`);
}

const registered = await response.json();
const scope = guildId ? `servidor ${guildId}` : "global";
console.log(`Registrados ${registered.length} comandos no escopo ${scope}: /loja, /ajuda.`);
