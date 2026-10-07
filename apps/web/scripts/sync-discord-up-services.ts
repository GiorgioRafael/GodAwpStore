import { IS_GWSTORE } from "../src/lib/brand";
async function main() {
  const deployment = process.argv.includes("--deployment");
  if (!IS_GWSTORE || (deployment && process.env.VERCEL_ENV !== "production")) return;
  const { synchronizeGwStoreUpServices } = await import("../src/lib/bot/discord-up-server");
  console.log("[discord:up-services]", JSON.stringify(await synchronizeGwStoreUpServices()));
}
void main().catch(error => { console.error("[discord:up-services]", error instanceof Error ? error.message : "Falha ao publicar UP."); process.exitCode = 1; });
