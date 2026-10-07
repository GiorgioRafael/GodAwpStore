import { IS_GWSTORE } from "../src/lib/brand";
async function main() {
  const deployment = process.argv.includes("--deployment");
  if (!IS_GWSTORE || (deployment && process.env.VERCEL_ENV !== "production")) return;
  const { synchronizeGwStoreUpServices } = await import("../src/lib/bot/discord-up-server");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log("[discord:up-services]", JSON.stringify(await synchronizeGwStoreUpServices()));
      return;
    } catch (error) {
      const retryable = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
      if (!retryable || attempt === 3) throw error;
      console.log("[discord:up-services]", `Timeout transitório; repetindo publicação idempotente (${attempt}/3).`);
    }
  }
}
void main().catch(error => {
  console.error("[discord:up-services]", error instanceof Error ? error.message : "Falha ao publicar UP.");
  // A temporary Discord failure must not take the existing store offline.
  // Publication remains visible in deployment logs and can be safely retried.
  if (!process.argv.includes("--deployment")) process.exitCode = 1;
});
