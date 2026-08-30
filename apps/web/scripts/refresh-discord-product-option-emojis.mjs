/**
 * Writes the already-created application emojis into options on published
 * storefront messages. Keeping this plain Node script avoids loading the
 * React Discord adapter after the production build, while making photo fixes
 * visible in existing storefronts without an admin having to republish them.
 */
const isDeploymentRefresh = process.argv.includes("--deployment");

if (isDeploymentRefresh && process.env.VERCEL_ENV !== "production") {
  console.log("Fotos dos produtos no Discord: atualização ignorada fora da produção.");
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()?.replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();

if (!supabaseUrl || !serviceRoleKey || !botToken) {
  console.log("Fotos dos produtos no Discord: configuração de produção incompleta.");
  process.exit(0);
}

try {
  const [products, guilds] = await Promise.all([
    supabaseSelect(
      "products?status=eq.active&archived_at=is.null&discord_application_emoji_id=not.is.null&select=id,discord_application_emoji_id,discord_application_emoji_source_sha256",
    ),
    supabaseSelect("guilds?status=eq.active&archived_at=is.null&select=configuration"),
  ]);
  const emojis = productEmojiMap(products);
  let storefronts = 0;
  let options = 0;

  for (const guild of guilds) {
    for (const storefront of storefrontConfigurations(asObject(guild.configuration))) {
      for (const messageId of storefront.message_ids) {
        try {
          const updated = await refreshStorefrontOptions(storefront.channel_id, messageId, emojis);
          if (updated > 0) {
            storefronts += 1;
            options += updated;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "erro desconhecido";
          console.warn(`[discord-product-option-emojis] vitrine ignorada: ${message}`);
        }
      }
    }
  }

  console.log(`Fotos dos produtos no Discord: ${options} opção(ões) atualizada(s) em ${storefronts} vitrine(s).`);
} catch (error) {
  // A Discord outage must not make an otherwise valid Vercel deployment fail.
  const message = error instanceof Error ? error.message : "erro desconhecido";
  console.error(`[discord-product-option-emojis] ${message}`);
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

function productEmojiMap(products) {
  const emojis = new Map();
  for (const product of products) {
    const id = uuid(product.id);
    const emojiId = snowflake(product.discord_application_emoji_id);
    const source = sha256(product.discord_application_emoji_source_sha256);
    if (!id || !emojiId || !source) continue;
    emojis.set(id, {
      id: emojiId,
      name: `gw_${id.replaceAll("-", "").slice(0, 12)}_${source.slice(0, 8)}`,
      animated: false,
    });
  }
  return emojis;
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

async function refreshStorefrontOptions(channelId, messageId, emojis) {
  const message = await getDiscordMessage(channelId, messageId);
  const components = cloneJson(message.components);
  if (!Array.isArray(components)) return 0;
  const changed = replaceProductOptionEmojis(components, emojis);
  if (changed > 0) await patchDiscordMessage(channelId, messageId, { components });
  return changed;
}

function replaceProductOptionEmojis(components, emojis) {
  let changed = 0;
  for (const component of components) {
    const record = asObject(component);
    if (record.type === 3 && Array.isArray(record.options)) {
      for (const option of record.options) {
        const productId = productIdFromOption(asObject(option).value);
        if (!productId) continue;
        const emoji = emojis.get(productId);
        if (emoji) {
          if (JSON.stringify(asObject(option).emoji) !== JSON.stringify(emoji)) {
            option.emoji = emoji;
            changed += 1;
          }
        } else if (isProductEmoji(asObject(option).emoji)) {
          delete option.emoji;
          changed += 1;
        }
      }
    }
    if (Array.isArray(record.components)) changed += replaceProductOptionEmojis(record.components, emojis);
  }
  return changed;
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

function productIdFromOption(value) {
  if (typeof value !== "string") return null;
  return uuid(value.slice(0, 36));
}

function isProductEmoji(value) {
  return /^gw_[a-f0-9]{12}_[a-f0-9]{8}$/i.test(asObject(value).name ?? "");
}

function uuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function sha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value : null;
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
