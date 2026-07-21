import "server-only";

import sharp from "sharp";

import { getSupabaseServerConfig } from "@/lib/env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { discordBotJson, discordBotRequest } from "./discord-api";
import {
  discordProductEmojiName,
  discordProductImageSourceSha256,
} from "./discord-product-emoji-shared";

const APPLICATION_ID_PATTERN = /^[0-9]{15,22}$/;
const EMOJI_ID_PATTERN = /^[0-9]{15,22}$/;
const PRODUCT_IMAGE_PATH_PATTERN =
  /^\/storage\/v1\/object\/public\/catalog-media\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DISCORD_EMOJI_BYTES = 256 * 1024;
const MAX_INPUT_PIXELS = 16_777_216;
const IMAGE_FETCH_TIMEOUT_MS = 6_000;

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabaseClient>>;

type ProductEmojiRow = {
  id: string;
  image_url: string | null;
  status: "active" | "inactive" | "archived";
  archived_at: string | null;
  updated_at: string;
  discord_application_emoji_id: string | null;
  discord_application_emoji_source_sha256: string | null;
};

export type DiscordProductEmojiSyncResult = {
  created: number;
  replaced: number;
  deleted: number;
  unchanged: number;
  failed: number;
  failures: Array<{ productId: string; message: string }>;
};

export async function synchronizeDiscordProductEmojis(
  client: AdminClient = requireClient(),
  fetcher: typeof fetch = fetch,
): Promise<DiscordProductEmojiSyncResult> {
  const { data, error } = await client
    .from("products")
    .select(
      "id,image_url,status,archived_at,updated_at,discord_application_emoji_id,discord_application_emoji_source_sha256",
    );
  if (error) throw new Error("Não foi possível consultar os ícones dos produtos.");

  const result: DiscordProductEmojiSyncResult = {
    created: 0,
    replaced: 0,
    deleted: 0,
    unchanged: 0,
    failed: 0,
    failures: [],
  };

  for (const product of (data ?? []) as ProductEmojiRow[]) {
    try {
      const operation = await synchronizeProductEmoji(client, product, fetcher);
      result[operation] += 1;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "erro desconhecido";
      console.error(`[discord-product-emoji:${product.id}] ${message}`);
      result.failed += 1;
      result.failures.push({ productId: product.id, message });
    }
  }

  return result;
}

async function synchronizeProductEmoji(
  client: AdminClient,
  product: ProductEmojiRow,
  fetcher: typeof fetch,
): Promise<"created" | "replaced" | "deleted" | "unchanged"> {
  const shouldHaveEmoji =
    product.status === "active" && product.archived_at === null && product.image_url !== null;

  if (!shouldHaveEmoji) {
    if (!product.discord_application_emoji_id) return "unchanged";
    await deleteApplicationEmoji(product.discord_application_emoji_id, fetcher);
    await updateProductEmojiMetadata(client, product, null, null);
    return "deleted";
  }

  const imageUrl = validateProductImageUrl(product.image_url ?? "");
  const sourceSha256 = discordProductImageSourceSha256(imageUrl);
  if (
    product.discord_application_emoji_id &&
    product.discord_application_emoji_source_sha256 === sourceSha256
  ) {
    return "unchanged";
  }

  const image = await downloadAndPrepareEmoji(imageUrl, fetcher);
  const emojiName = discordProductEmojiName(product.id, sourceSha256);
  const createdEmoji = await createApplicationEmoji(emojiName, image, fetcher);

  try {
    await updateProductEmojiMetadata(client, product, createdEmoji.id, sourceSha256);
  } catch (error) {
    await deleteApplicationEmoji(createdEmoji.id, fetcher).catch(() => undefined);
    throw error;
  }

  if (product.discord_application_emoji_id) {
    await deleteApplicationEmoji(product.discord_application_emoji_id, fetcher).catch((error) => {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      console.error(`[discord-product-emoji:cleanup:${product.id}] ${message}`);
    });
    return "replaced";
  }

  return "created";
}

function validateProductImageUrl(value: string) {
  const config = getSupabaseServerConfig();
  if (!config) throw new Error("Supabase server-only não configurado.");

  let imageUrl: URL;
  let supabaseUrl: URL;
  try {
    imageUrl = new URL(value);
    supabaseUrl = new URL(config.url);
  } catch {
    throw new Error("URL da foto do produto inválida.");
  }

  if (
    imageUrl.origin !== supabaseUrl.origin ||
    imageUrl.protocol !== "https:" ||
    imageUrl.username ||
    imageUrl.password ||
    imageUrl.search ||
    imageUrl.hash ||
    !PRODUCT_IMAGE_PATH_PATTERN.test(imageUrl.pathname)
  ) {
    throw new Error("A foto do produto não pertence ao armazenamento autorizado.");
  }

  return imageUrl.toString();
}

async function downloadAndPrepareEmoji(imageUrl: string, fetcher: typeof fetch) {
  const response = await fetcher(imageUrl, {
    method: "GET",
    headers: { Accept: "image/png,image/webp,image/jpeg" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Não foi possível baixar a foto do produto (${response.status}).`);

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error("A foto do produto retornou um formato não permitido.");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("A foto do produto excede 5 MB.");
  }

  const source = await readLimitedResponseBody(response, MAX_SOURCE_IMAGE_BYTES);
  let prepared: Buffer;
  try {
    prepared = await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .resize(128, 128, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer();
  } catch {
    throw new Error("A foto do produto não pôde ser convertida em ícone.");
  }

  if (prepared.byteLength > MAX_DISCORD_EMOJI_BYTES) {
    throw new Error("O ícone convertido excede 256 KiB.");
  }
  return `data:image/webp;base64,${prepared.toString("base64")}`;
}

async function readLimitedResponseBody(response: Response, limit: number) {
  if (!response.body) throw new Error("A foto do produto retornou um corpo vazio.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error("A foto do produto excede 5 MB.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error("A foto do produto retornou um corpo vazio.");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function createApplicationEmoji(
  name: string,
  image: string,
  fetcher: typeof fetch,
) {
  const applicationId = applicationIdFromEnvironment();
  const payload = await discordBotJson<{ id?: unknown; name?: unknown }>(
    `/applications/${applicationId}/emojis`,
    {
      method: "POST",
      body: JSON.stringify({ name, image }),
    },
    fetcher,
  );
  if (typeof payload.id !== "string" || !EMOJI_ID_PATTERN.test(payload.id)) {
    throw new Error("Discord retornou um emoji de produto inválido.");
  }
  return { id: payload.id };
}

async function deleteApplicationEmoji(emojiId: string, fetcher: typeof fetch) {
  if (!EMOJI_ID_PATTERN.test(emojiId)) throw new Error("ID do emoji de produto inválido.");
  const applicationId = applicationIdFromEnvironment();
  const response = await discordBotRequest(
    `/applications/${applicationId}/emojis/${emojiId}`,
    { method: "DELETE" },
    fetcher,
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Discord recusou a remoção do emoji (${response.status}).`);
  }
}

async function updateProductEmojiMetadata(
  client: AdminClient,
  product: ProductEmojiRow,
  emojiId: string | null,
  sourceSha256: string | null,
) {
  const { data, error } = await client
    .from("products")
    .update({
      discord_application_emoji_id: emojiId,
      discord_application_emoji_source_sha256: sourceSha256,
    })
    .eq("id", product.id)
    .eq("updated_at", product.updated_at)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error("O produto mudou durante a sincronização do ícone.");
  }
}

function applicationIdFromEnvironment() {
  const applicationId = process.env.DISCORD_APPLICATION_ID?.trim() ?? "";
  if (!APPLICATION_ID_PATTERN.test(applicationId)) {
    throw new Error("DISCORD_APPLICATION_ID não configurado ou inválido.");
  }
  return applicationId;
}

function requireClient() {
  const client = createAdminSupabaseClient();
  if (!client) throw new Error("Supabase server-only não configurado.");
  return client;
}
