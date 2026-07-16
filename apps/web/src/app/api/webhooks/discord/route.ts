import { after } from "next/server";

import { getDiscordBot } from "@/lib/bot/discord-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await getDiscordBot().webhooks.discord(request, {
      waitUntil: (task) => after(() => task),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    console.error(`[discord-webhook] ${message}`);
    return Response.json({ error: "Discord bot indisponível." }, { status: 503 });
  }
}
