/**
 * Syncs product photos as Discord application emojis during a production
 * deployment. It repairs storefronts that were published before photo sync
 * was enabled without making ordinary deployments fail because Discord is
 * temporarily unavailable.
 */
const isDeployment = process.argv.includes("--deployment");
const enabled = process.env.DISCORD_PRODUCT_EMOJI_SYNC_ENABLED?.trim().toLowerCase() === "true";

async function main() {
  if (!isDeployment || !enabled) {
    console.log("Ícones dos produtos no Discord: sincronização desativada.");
    return;
  }

  try {
    const { synchronizeDiscordProductEmojis } = await import(
      "../src/lib/bot/discord-product-emojis"
    );
    const icons = await synchronizeDiscordProductEmojis();
    const changed = icons.created + icons.replaced + icons.deleted;

    if (changed > 0) {
      const { synchronizePublishedDiscordStorefronts } = await import(
        "../src/lib/bot/discord-storefront-sync"
      );
      const storefronts = await synchronizePublishedDiscordStorefronts();
      console.log(
        `Ícones dos produtos no Discord: ${icons.created} criados, ${icons.replaced} atualizados, ${icons.deleted} removidos; ${storefronts.published} vitrine(s) atualizada(s).`,
      );
      if (icons.failed > 0 || storefronts.failed > 0 || storefronts.productEmojiFailures > 0) {
        console.warn(
          `Ícones dos produtos no Discord: ${icons.failed + storefronts.productEmojiFailures} falharam; ${storefronts.failed} vitrine(s) não puderam ser atualizadas.`,
        );
      }
    } else if (icons.failed > 0) {
      console.warn(
        `Ícones dos produtos no Discord: ${icons.failed} não puderam ser sincronizados nesta tentativa.`,
      );
    } else {
      console.log("Ícones dos produtos no Discord: já estavam atualizados.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.warn(`[discord-product-emojis:deployment] ${message}`);
  }
}

void main();
