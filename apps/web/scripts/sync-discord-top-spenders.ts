import { IS_GWSTORE } from "../src/lib/brand";

async function main() {
  const deployment = process.argv.includes("--deployment");
  if (!IS_GWSTORE || (deployment && process.env.VERCEL_ENV !== "production")) return;
  try {
    const { synchronizeGwStoreTopSpenders } = await import("../src/lib/bot/discord-top-spenders");
    const result = await synchronizeGwStoreTopSpenders();
    console.log("[discord:top-spenders]", JSON.stringify(result));
  } catch (error) {
    console.error("[discord:top-spenders]", error instanceof Error ? error.message : "failed");
    if (!deployment) process.exitCode = 1;
  }
}

void main();
