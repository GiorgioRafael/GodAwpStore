const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const DISCORD_STOREFRONT_PRODUCT_LIMIT = 25;

export type DiscordProductEmoji = {
  id: string;
  name: string;
  animated: false;
};

export function discordProductImageSourceSha256(imageUrl: string) {
  return createHash("sha256").update(imageUrl, "utf8").digest("hex");
}

export function discordProductEmojiName(productId: string, sourceSha256: string) {
  if (!UUID_PATTERN.test(productId) || !SHA256_PATTERN.test(sourceSha256)) {
    throw new Error("Metadados do emoji de produto inválidos.");
  }
  return `gw_${productId.replaceAll("-", "").slice(0, 12)}_${sourceSha256.slice(0, 8)}`;
}

export function readDiscordProductEmoji(
  productId: string,
  emojiId: string | null | undefined,
  sourceSha256: string | null | undefined,
): DiscordProductEmoji | null {
  if (!emojiId || !sourceSha256) return null;
  if (!SNOWFLAKE_PATTERN.test(emojiId) || !SHA256_PATTERN.test(sourceSha256)) return null;
  try {
    return {
      id: emojiId,
      name: discordProductEmojiName(productId, sourceSha256),
      animated: false,
    };
  } catch {
    return null;
  }
}
import { createHash } from "node:crypto";
