import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { IS_GWSTORE } from "@/lib/brand";
import type { Json } from "@/lib/supabase/database.types";
import { assertConfiguredDiscordBotIdentity, discordApiUrl, discordBotJson } from "./discord-api";
import { GW_UP_CATEGORIES, GW_UP_ENTRY_TITLE, GW_UP_GUILD_ID, GW_UP_STORE_ID, upServiceDescription } from "./gw-up-catalog";
import { upCategoryMessage, upEntryMessage, upServiceMessage, upText, type UpInteraction } from "./discord-up";
import { readDiscordInteraction } from "./discord-context";
import { SupabaseBotCommerceRepository } from "./supabase-repository";
import { completeDiscordCartPurchase } from "./discord-cart";
import { loadBotMessageCustomization } from "./message-customization-server";

const SNOWFLAKE = /^[0-9]{15,22}$/;
type Channel = { id: string; guild_id: string; type: number; name: string };
type Message = { id: string; channel_id: string; author: { id: string }; embeds?: { title?: string }[] };
type UpConfiguration = { channel_id: string; message_id: string; catalog_store_id: string };
export function readUpConfiguration(value: unknown): UpConfiguration | null {
  if (!object(value) || !object(value.up_services)) return null;
  const up = value.up_services;
  return typeof up.channel_id === "string" && SNOWFLAKE.test(up.channel_id) && typeof up.message_id === "string" && SNOWFLAKE.test(up.message_id) && up.catalog_store_id === GW_UP_STORE_ID
    ? { channel_id: up.channel_id, message_id: up.message_id, catalog_store_id: GW_UP_STORE_ID } : null;
}

/** Inserts only missing rows: deployments never undo prices or pauses set by staff. */
export async function synchronizeGwStoreUpServices() {
  if (!IS_GWSTORE) return { status: "disabled" };
  const client = requireClient();
  const { data: games, error: gamesError } = await client.from("games").select("id,name,slug").eq("status", "active").is("archived_at", null);
  if (gamesError) throw new Error("Não foi possível consultar o jogo para os serviços de UP.");
  const game = games?.find(row => canonical(row.slug) === "blox-fruits" || canonical(row.name) === "blox-fruits");
  if (!game) throw new Error("Cadastre o jogo Blox Fruits antes de publicar serviços de UP.");
  const botId = await assertConfiguredDiscordBotIdentity();
  const channels = await discordBotJson<Channel[]>(`/guilds/${GW_UP_GUILD_ID}/channels`);
  const candidates = channels.filter(channel => channel.type === 0 && canonical(channel.name) === "upper-precos");
  if (candidates.length !== 1) throw new Error("Não foi encontrado um único canal upper-preços na GWStore.");
  const channel = candidates[0];
  if (channel.guild_id !== GW_UP_GUILD_ID) throw new Error("Canal de UP pertence a outro servidor.");
  const { error: schemaError } = await client.from("products").select("id,unlimited_stock").limit(1);
  if (schemaError) throw new Error("Aplique a migração de serviços sem estoque antes de publicar UP.");
  const { error: storeError } = await client.from("catalog_stores").upsert({ id: GW_UP_STORE_ID, game_id: game.id, name: "Serviços de UP", slug: "servicos-up", is_default: false, sort_order: 100, status: "active" }, { onConflict: "id", ignoreDuplicates: true });
  if (storeError) throw new Error("Não foi possível cadastrar a loja de serviços de UP.");
  const { error: categoryError } = await client.from("substores").upsert(GW_UP_CATEGORIES.map((category, index) => ({ id: category.id, game_id: game.id, name: `UP · ${category.name}`, slug: `up-${category.key}`, title: `${category.emoji} ${category.name}`, description: "Serviços de Blox Fruits realizados pela equipe da GWStore.", color_hex: "#b83cbf", status: "active" as const, sort_order: 100 + index })), { onConflict: "id", ignoreDuplicates: true });
  if (categoryError) throw new Error("Não foi possível cadastrar as categorias de UP.");
  const rows = GW_UP_CATEGORIES.flatMap(category => category.services.map((service, index) => ({ id: service.id, substore_id: category.id, catalog_store_id: GW_UP_STORE_ID, name: service.name, slug: `up-${category.key}-${canonical(service.name)}`, description: upServiceDescription(service), minimum_price_cents: service.priceCents, stock_quantity: 0, unlimited_stock: true, low_stock_threshold: 0, status: "active" as const, sort_order: index })));
  const { error: productsError } = await client.from("products").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (productsError) throw new Error("Não foi possível cadastrar a tabela de serviços de UP.");
  let message: Message | null = null;
  let before = "";
  for (let page = 0; page < 20; page++) {
    const messages = await discordBotJson<Message[]>(`/channels/${channel.id}/messages?limit=100${before ? `&before=${before}` : ""}`);
    const matches = messages.filter(row => row.author?.id === botId && row.embeds?.[0]?.title === GW_UP_ENTRY_TITLE);
    if (matches.length > 1 || (message && matches.length)) throw new Error("Há mais de uma vitrine de UP deste bot no canal.");
    message = matches[0] ?? message;
    if (messages.length < 100) break;
    if (page === 19) throw new Error("Canal de UP muito extenso; não foi possível verificar a vitrine existente.");
    before = messages[messages.length - 1].id;
  }
  const published = await discordBotJson<Message>(`/channels/${channel.id}/messages${message ? `/${message.id}` : ""}`, { method: message ? "PATCH" : "POST", body: JSON.stringify({ ...upEntryMessage(), ...(!message ? { nonce: `up:${channel.id}`, enforce_nonce: true } : {}) }) });
  if (!SNOWFLAKE.test(published.id) || published.channel_id !== channel.id || published.author?.id !== botId) throw new Error("Discord não confirmou a vitrine de UP.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: guild, error } = await client.from("guilds").select("id,configuration,updated_at").eq("discord_guild_id", GW_UP_GUILD_ID).eq("status", "active").is("archived_at", null).single();
    if (error || !guild) throw new Error("Servidor GWStore não está cadastrado no painel.");
    const configuration = { ...(object(guild.configuration) ? guild.configuration : {}), up_services: { channel_id: channel.id, message_id: published.id, catalog_store_id: GW_UP_STORE_ID } } as Json;
    const { data: updated, error: saveError } = await client.from("guilds").update({ configuration }).eq("id", guild.id).eq("updated_at", guild.updated_at).select("id").maybeSingle();
    if (saveError) throw new Error("Não foi possível salvar a vitrine de UP.");
    if (updated) return { status: "published", channelId: channel.id, messageId: published.id, services: rows.length, categories: GW_UP_CATEGORIES.length };
  }
  throw new Error("A configuração do servidor mudou durante a publicação. Tente novamente.");
}

export async function completeUpInteraction(raw: unknown, interaction: UpInteraction, fetcher: typeof fetch = fetch) {
  const context = readDiscordInteraction(raw, "");
  try {
    if (!IS_GWSTORE || context.guildId !== GW_UP_GUILD_ID || !context.channelId || !context.userId) throw new Error("Abra os serviços de UP no servidor GWStore.");
    const client = requireClient();
    const { data: guild, error } = await client.from("guilds").select("configuration").eq("discord_guild_id", GW_UP_GUILD_ID).eq("status", "active").is("archived_at", null).maybeSingle();
    const configuration = readUpConfiguration(guild?.configuration);
    if (error || !configuration || configuration.channel_id !== context.channelId) throw new Error("Use a vitrine de UP mais recente no canal upper-preços.");
    if (interaction.kind === "category" && object(raw) && object(raw.message) &&
      (Number(raw.message.flags ?? 0) & 64) === 0 && raw.message.id !== configuration.message_id) throw new Error("Esta vitrine foi substituída. Use a mensagem mais recente.");
    const catalog = await new SupabaseBotCommerceRepository(client).listCatalog();
    const store = catalog.find(row => row.catalogStoreId === GW_UP_STORE_ID);
    const products = store?.substores.flatMap(category => category.products).filter(product => product.unlimitedStock) ?? [];
    if (interaction.kind === "categories") return await update(raw, upEntryMessage(), fetcher);
    if (interaction.kind === "category") {
      const category = GW_UP_CATEGORIES.find(row => row.key === interaction.categoryKey)!;
      const allowedIds = new Set(category.services.map(service => service.id));
      return await update(raw, upCategoryMessage(category, products.filter(product => allowedIds.has(product.id))), fetcher);
    }
    if (interaction.kind === "quantity") return;
    const product = products.find(row => row.id === interaction.productId);
    if (!product) throw new Error("Este serviço está pausado ou indisponível. Escolha outra opção.");
    if (interaction.kind === "service") return await update(raw, upServiceMessage(product), fetcher);
    if (!interaction.confirmed) throw new Error("Confira os requisitos do serviço e digite SIM para continuar.");
    if (!interaction.quantity) throw new Error("Informe uma quantidade inteira entre 1 e 10.000 pacotes.");
    await completeDiscordCartPurchase(raw, await loadBotMessageCustomization(), [{ productId: product.id, quantity: interaction.quantity }]);
  } catch (error) {
    console.error("[discord:up]", error instanceof Error ? error.message : "Falha ao abrir serviço.");
    await update(raw, upText(error instanceof Error ? error.message : "Não foi possível continuar agora. Tente novamente.", true), fetcher);
  }
}
async function update(raw: unknown, payload: object, fetcher: typeof fetch) {
  if (!object(raw) || raw.application_id !== process.env.DISCORD_APPLICATION_ID?.trim() || typeof raw.token !== "string" || !/^[A-Za-z0-9._-]{20,500}$/.test(raw.token)) throw new Error("Interação de UP inválida.");
  const response = await fetcher(`${discordApiUrl()}/webhooks/${raw.application_id}/${raw.token}/messages/@original`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, flags: 64 }), cache: "no-store" });
  if (!response.ok) throw new Error(`Discord recusou a resposta de UP (${response.status}).`);
}
function requireClient() { const client = createAdminSupabaseClient(); if (!client) throw new Error("A loja está temporariamente indisponível."); return client; }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function canonical(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
