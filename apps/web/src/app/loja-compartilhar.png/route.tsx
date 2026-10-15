import { ImageResponse } from "next/og";
import { join } from "node:path";
import sharp from "sharp";

import { isPublicShopRequest } from "@/lib/shop/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!isPublicShopRequest(request)) return new Response(null, { status: 404 });

  // Reuse the shop's local artwork. No remote fetches, prices or delivery claims.
  const artwork = await sharp(join(process.cwd(), "public", "brands", "gwstore-shop-hero.webp"))
    .resize(1512, 630, { fit: "cover" }).png().toBuffer();

  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#0b0810", color: "#fff", position: "relative", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${artwork.toString("base64")}`} alt="" width={1512} height={630}
        style={{ position: "absolute", right: -160, top: 0 }} />
      <div style={{ display: "flex", position: "absolute", inset: 0, background: "linear-gradient(90deg, #0b0810 0%, rgba(11,8,16,0.97) 25%, rgba(11,8,16,0.64) 50%, rgba(11,8,16,0) 80%)" }} />
      <div style={{ display: "flex", position: "relative", flexDirection: "column", justifyContent: "space-between", width: "100%", padding: "52px 62px" }}>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700, letterSpacing: -2 }}>GW<span style={{ color: "#ff30b9" }}>Store</span></div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 660 }}>
          <div style={{ display: "flex", fontSize: 66, lineHeight: 1.08, fontWeight: 700, letterSpacing: -2 }}>Seu próximo upgrade</div>
          <div style={{ display: "flex", color: "#ff54c8", fontSize: 66, lineHeight: 1.08, fontWeight: 700, letterSpacing: -2 }}>começa aqui.</div>
          <div style={{ display: "flex", fontSize: 25, marginTop: 24, color: "#e8d8ec" }}>Frutas, skins e serviços de Blox Fruits.</div>
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#e8d8ec" }}>gwstoreofc.com</div>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } },
  );
}
