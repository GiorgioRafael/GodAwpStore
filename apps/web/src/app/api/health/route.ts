export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness only: downstream outages must not trigger web server restarts. */
export function GET() {
  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store" },
  });
}
