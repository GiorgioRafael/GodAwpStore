const isDeploymentRefresh = process.argv.includes("--deployment");

if (isDeploymentRefresh && process.env.VERCEL_ENV !== "production") {
  console.log("Atualização de banners ignorada fora da produção.");
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();

if (!supabaseUrl || !serviceRoleKey || !botToken) {
  console.log("Atualização de banners ignorada: configuração de produção incompleta.");
  process.exit(0);
}

try {
  const settings = await supabaseSelect(
    "platform_settings?id=eq.1&select=bot_message_config,roulette_promotion_banner_url,roulette_promotion_channel_id,roulette_promotion_message_id",
  ).then((rows) => rows[0] ?? null);
  if (!settings) throw new Error("Configuração global não encontrada.");

  const storefrontBannerUrl = readHttpsUrl(
    settings.bot_message_config?.storefront?.bannerUrl,
  );
  const rouletteBannerUrl = readHttpsUrl(settings.roulette_promotion_banner_url);
  const guilds = await supabaseSelect(
    "guilds?status=eq.active&archived_at=is.null&select=configuration",
  );

  let storefronts = 0;
  let robux = 0;
  for (const guild of guilds) {
    const configuration = asObject(guild.configuration);
    if (storefrontBannerUrl) {
      for (const storefront of storefrontConfigurations(configuration)) {
        for (const messageId of storefront.message_ids) {
          if (await replaceStorefrontBanner(storefront.channel_id, messageId, storefrontBannerUrl)) {
            storefronts += 1;
          }
        }
      }
    }

    const robuxStorefront = asObject(configuration.robux_storefront);
    const channelId = snowflake(robuxStorefront.channel_id);
    const messageId = snowflake(robuxStorefront.message_id);
    if (channelId && messageId && storefrontBannerUrl) {
      if (await replaceEmbedBanner(channelId, messageId, storefrontBannerUrl)) robux += 1;
    }
  }

  let roulette = 0;
  const rouletteChannelId = snowflake(settings.roulette_promotion_channel_id);
  const rouletteMessageId = snowflake(settings.roulette_promotion_message_id);
  if (rouletteChannelId && rouletteMessageId && rouletteBannerUrl) {
    roulette = (await replaceEmbedBanner(rouletteChannelId, rouletteMessageId, rouletteBannerUrl))
      ? 1
      : 0;
  }

  console.log(`Banners atualizados no Discord: ${storefronts} vitrine(s), ${robux} Robux, ${roulette} roleta.`);
} catch (error) {
  // A deployment must never be rejected just because Discord is briefly down.
  // The next production deployment retries this idempotent update in place.
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-brand-banners] ${message}`);
}

async function supabaseSelect(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase recusou a leitura (${response.status}).`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("Resposta do Supabase inválida.");
  return body;
}

function storefrontConfigurations(configuration) {
  const raw = Array.isArray(configuration.storefronts)
    ? configuration.storefronts
    : configuration.storefront
      ? [configuration.storefront]
      : [];
  return raw.flatMap((item) => {
    const storefront = asObject(item);
    const channelId = snowflake(storefront.channel_id);
    const messageIds = Array.isArray(storefront.message_ids)
      ? storefront.message_ids.map(snowflake).filter(Boolean)
      : [];
    return channelId && messageIds.length ? [{ channel_id: channelId, message_ids: messageIds }] : [];
  });
}

async function replaceStorefrontBanner(channelId, messageId, bannerUrl) {
  const message = await getDiscordMessage(channelId, messageId);
  const components = cloneJson(message.components);
  if (!Array.isArray(components) || !replaceFirstMediaGallery(components, bannerUrl)) return false;
  await patchDiscordMessage(channelId, messageId, { components });
  return true;
}

async function replaceEmbedBanner(channelId, messageId, bannerUrl) {
  const message = await getDiscordMessage(channelId, messageId);
  if (!Array.isArray(message.embeds) || message.embeds.length === 0) return false;
  const embeds = message.embeds.map((embed, index) => {
    if (index !== 0 || !asObject(embed)) return embed;
    return { ...writableEmbed(embed), image: { url: bannerUrl } };
  });
  await patchDiscordMessage(channelId, messageId, { embeds });
  return true;
}

async function getDiscordMessage(channelId, messageId) {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!response.ok) throw new Error(`Discord recusou a leitura da mensagem (${response.status}).`);
  const body = await response.json();
  if (!asObject(body)) throw new Error("Mensagem Discord inválida.");
  return body;
}

async function patchDiscordMessage(channelId, messageId, payload) {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Discord recusou a atualização da mensagem (${response.status}).`);
}

function replaceFirstMediaGallery(value, bannerUrl) {
  if (!Array.isArray(value)) return false;
  for (const component of value) {
    const record = asObject(component);
    if (record.type === 12 && Array.isArray(record.items)) {
      record.items = [{ media: { url: bannerUrl } }];
      return true;
    }
    if (replaceFirstMediaGallery(record.components, bannerUrl)) return true;
  }
  return false;
}

function readHttpsUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function snowflake(value) {
  return typeof value === "string" && /^[0-9]{15,22}$/.test(value) ? value : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function writableEmbed(value) {
  const embed = asObject(value);
  const writableKeys = [
    "title",
    "description",
    "url",
    "timestamp",
    "color",
    "footer",
    "image",
    "thumbnail",
    "author",
    "fields",
  ];
  return Object.fromEntries(
    writableKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(embed, key))
      .map((key) => [key, embed[key]]),
  );
}
