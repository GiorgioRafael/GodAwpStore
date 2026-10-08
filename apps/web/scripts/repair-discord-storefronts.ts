import { IS_GWSTORE } from "../src/lib/brand";

async function main() {
  const deployment = process.argv.includes("--deployment");
  if (!IS_GWSTORE || (deployment && process.env.VERCEL_ENV !== "production")) return;
  try {
    const { synchronizePublishedDiscordStorefronts } = await import("../src/lib/bot/discord-storefront-sync");
    const result = await synchronizePublishedDiscordStorefronts();
    console.log("[discord-storefronts:repair]", JSON.stringify(result));
    if (result.failed > 0 && !deployment) process.exitCode = 1;
  } catch (error) {
    console.error("[discord-storefronts:repair]", error instanceof Error ? error.message : "failed");
    if (!deployment) process.exitCode = 1;
  }
}

await main();
