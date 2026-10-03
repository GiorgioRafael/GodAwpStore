import { IS_GWSTORE } from "../src/lib/brand";

async function main() {
  const deployment = process.argv.includes("--deployment");
  if (!IS_GWSTORE || (deployment && process.env.VERCEL_ENV !== "production")) return;
  try {
    const { synchronizeGwStoreTicketCategories } = await import("../src/lib/bot/discord-ticket-categories");
    console.log("[discord:ticket-categories]", JSON.stringify(await synchronizeGwStoreTicketCategories()));
  } catch (error) {
    console.error("[discord:ticket-categories]", error instanceof Error ? error.message : "Falha ao organizar tickets.");
    if (!deployment) process.exitCode = 1;
  }
}

void main();
