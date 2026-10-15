import { isIndexableShopRequest, SHOP_CANONICAL_ORIGIN, SHOP_PUBLIC_PATHS, SHOP_SOCIAL_IMAGE_PATH } from "@/lib/shop/seo";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const lines = ["User-agent: *", "Disallow: /"];
  if (isIndexableShopRequest(request)) {
    // Allow only the public storefront and information pages, never orders,
    // payment links, login, APIs or any current/future administrative route.
    lines.push(...SHOP_PUBLIC_PATHS.map(path => `Allow: ${path}$`),
      "Allow: /_next/static/", "Allow: /_next/image", "Allow: /brands/",
      "Allow: /icon.png", `Allow: ${SHOP_SOCIAL_IMAGE_PATH}$`,
      `Sitemap: ${SHOP_CANONICAL_ORIGIN}/sitemap.xml`);
  }
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
