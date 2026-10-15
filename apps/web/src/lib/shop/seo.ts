import type { Metadata } from "next";

import { IS_GWSTORE, STORE_NAME } from "@/lib/brand";
import { publicRequestOrigin } from "@/lib/public-request-origin";

export const SHOP_CANONICAL_ORIGIN = "https://gwstoreofc.com";
export const SHOP_SOCIAL_IMAGE_PATH = "/loja-compartilhar.png";
export const SHOP_SOCIAL_IMAGE_ALT = "GWStore · Frutas, skins e serviços de Blox Fruits";
export const SHOP_PUBLIC_PATHS = ["/", "/atendimento", "/termos", "/privacidade", "/reembolsos"] as const;

const SHOP_PUBLIC_ORIGINS = new Set([
  SHOP_CANONICAL_ORIGIN,
  "https://www.gwstoreofc.com",
  "https://gwstore.vercel.app",
]);

/** A preview, the master dashboard and another store never advertise GW URLs. */
export function isPublicShopRequest(request: Request): boolean {
  return IS_GWSTORE && SHOP_PUBLIC_ORIGINS.has(publicRequestOrigin(request));
}

/** Only the public custom domain is indexed; the old login host stays private. */
export function isIndexableShopRequest(request: Request): boolean {
  return isPublicShopRequest(request)
    && publicRequestOrigin(request) !== "https://gwstore.vercel.app";
}

export function shopHomeMetadata(request: Request): Metadata {
  if (!IS_GWSTORE) return { title: "Visão geral" };

  const title = `${STORE_NAME} · Frutas, skins e serviços de Blox Fruits`;
  const description = "Escolha seus produtos, pague com Pix e receba atendimento no chat privado da sua compra na GWStore.";
  const base: Metadata = {
    title: { absolute: title },
    description,
    applicationName: STORE_NAME,
    robots: { index: false, follow: false },
  };
  if (!isPublicShopRequest(request)) return base;

  const image = {
    url: `${SHOP_CANONICAL_ORIGIN}${SHOP_SOCIAL_IMAGE_PATH}`,
    width: 1200,
    height: 630,
    alt: SHOP_SOCIAL_IMAGE_ALT,
    type: "image/png",
  };
  return {
    ...base,
    robots: { index: isIndexableShopRequest(request), follow: true },
    alternates: { canonical: SHOP_CANONICAL_ORIGIN },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: STORE_NAME,
      title,
      description,
      url: SHOP_CANONICAL_ORIGIN,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
