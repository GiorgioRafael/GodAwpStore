import { synchronizeAllOpenDiscordTicketControls } from "@/lib/bot/discord-ticket-controls-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret?.trim() ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return new Response("Unauthorized", {
      status: 401,
      headers: NO_STORE_HEADERS,
    });
  }

  try {
    const result = await synchronizeAllOpenDiscordTicketControls();
    return Response.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[internal:discord-ticket-controls-sync] synchronization failed", error);
    return Response.json(
      { ok: false, error: "Sincronização temporariamente indisponível." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
