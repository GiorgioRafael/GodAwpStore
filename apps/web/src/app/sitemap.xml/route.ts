import { isIndexableShopRequest, SHOP_CANONICAL_ORIGIN, SHOP_PUBLIC_PATHS } from "@/lib/shop/seo";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const urls = isIndexableShopRequest(request)
    ? SHOP_PUBLIC_PATHS.map(path => `  <url><loc>${SHOP_CANONICAL_ORIGIN}${path === "/" ? "" : path}</loc></url>`).join("\n")
    : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
