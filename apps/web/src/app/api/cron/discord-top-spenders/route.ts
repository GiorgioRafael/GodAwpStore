import { synchronizeGwStoreTopSpenders } from "@/lib/bot/discord-top-spenders";
import { shouldSkipVercelGwStoreCron } from "@/lib/railway-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (shouldSkipVercelGwStoreCron()) {
    return Response.json({ ok: true, status: "railway-managed" }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const topSpenders = await synchronizeGwStoreTopSpenders();
    return Response.json({ ok: true, topSpenders }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[cron:discord-top-spenders]", error instanceof Error ? error.message : "erro desconhecido");
    return Response.json({ ok: false, error: "Ranking temporariamente indisponível." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
