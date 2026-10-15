import type { Metadata } from "next";
import { headers } from "next/headers";

import { isIndexableShopRequest, isPublicShopRequest, SHOP_CANONICAL_ORIGIN, SHOP_PUBLIC_PATHS } from "./seo";

type InformationPath = Exclude<(typeof SHOP_PUBLIC_PATHS)[number], "/">;

/** Match the home page's origin guard without inheriting the admin noindex. */
export async function shopInformationMetadata(
  path: InformationPath,
  copy: { title: string; description: string },
): Promise<Metadata> {
  const metadata: Metadata = {
    title: { absolute: copy.title },
    description: copy.description,
    robots: { index: false, follow: false },
  };
  const requestHeaders = await headers();
  const protocol = process.env.NODE_ENV === "production" || requestHeaders.get("x-forwarded-proto") === "https"
    ? "https:" : "http:";
  try {
    const host = requestHeaders.get("host");
    if (!host) return metadata;
    const request = new Request(`${protocol}//${host}${path}`, { headers: requestHeaders });
    if (!isPublicShopRequest(request)) return metadata;
    return {
      ...metadata,
      robots: { index: isIndexableShopRequest(request), follow: true },
      alternates: { canonical: `${SHOP_CANONICAL_ORIGIN}${path}` },
    };
  } catch {
    // Missing/malformed request authority must never enable public indexing.
    return metadata;
  }
}
