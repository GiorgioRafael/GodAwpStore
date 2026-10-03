import { IS_GWSTORE } from "../src/lib/brand";

async function main() {
  const deployment = process.argv.includes("--deployment");
  if (!IS_GWSTORE || (deployment && process.env.VERCEL_ENV !== "production")) return;
  try {
    const { synchronizeGwStoreItemSelling } = await import("../src/lib/bot/discord-item-selling-server");
    console.log("[discord:item-selling]", JSON.stringify(await synchronizeGwStoreItemSelling()));
  } catch (error) {
    console.error("[discord:item-selling]", error instanceof Error ? error.message : "Falha ao publicar.");
    if (!deployment) process.exitCode = 1;
  }
}
void main();
