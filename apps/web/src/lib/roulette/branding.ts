import { STORE_CATALOG_LABEL, STORE_NAME, STORE_SLUG } from "@/lib/brand";

export type RouletteBranding = {
  storeName: string;
  catalogLabel: string;
  canonicalSiteUrl: string;
  bannerPath: string;
  embedColor: number;
  promotionMarker: string;
  promotion: {
    title: string;
    description: string;
    buttonLabel: string;
  };
  login: {
    eyebrow: string | null;
    title: string;
    description: string;
    trustMessage: string;
  };
  experience: {
    title: string;
    description: string;
  };
};

const GWSTORE_SITE_URL = "https://gwstore.vercel.app";
const THSTORE_SITE_URL = "https://thstoreadm.vercel.app";

/**
 * Everything a second roulette deployment is allowed to brand lives here.
 * Keeping URLs, copy, artwork and Discord metadata together prevents a new
 * surface from quietly falling back to GWStore again.
 */
export function rouletteBrandingFor(
  storeSlug: string,
  storeName: string,
  catalogLabel: string,
): RouletteBranding {
  if (storeSlug === "thstore") {
    return {
      storeName,
      catalogLabel,
      canonicalSiteUrl: THSTORE_SITE_URL,
      bannerPath: "/brands/thstore-roulette-banner.png",
      embedColor: 0x2f7bf0,
      promotionMarker: `${storeName} • ${catalogLabel} • roleta`,
      promotion: {
        title: `A Roleta Giro da ${storeName} chegou`,
        description:
          `Gire e descubra seus prêmios na Roleta Giro da ${storeName}. ` +
          "Cada giro custa R$ 1,00 e os itens ganhos ficam no seu inventário para vender ou resgatar pelo Discord.",
        buttonLabel: "Abrir a roleta",
      },
      login: {
        eyebrow: "ROULETA GIRO",
        title: `Gire na ${storeName}`,
        description:
          "Conecte seu Discord para guardar seus itens, acompanhar o inventário e pedir o resgate direto no servidor.",
        trustMessage:
          "Cada giro custa R$ 1,00 no Pix. O saldo entra automaticamente e todo prêmio fica registrado na sua conta.",
      },
      experience: {
        title: `Gire, ganhe e resgate na ${storeName}`,
        description:
          "Cada giro custa R$ 1,00. Venda o prêmio por moedas ou peça a entrega pelo seu inventário.",
      },
    };
  }

  return {
    storeName,
    catalogLabel,
    canonicalSiteUrl: GWSTORE_SITE_URL,
    bannerPath: "/brands/gwstore-storefront-banner.png",
    embedColor: 0xd946ef,
    // Preserve the original marker so the existing GWStore publication keeps
    // being found even if its database link is ever lost.
    promotionMarker: "GWStore • Grow a Garden 2 • roleta",
    promotion: {
      title: "A roleta da GWStore chegou",
      description:
        "Agora a GWStore tem uma roleta para você conseguir seus itens dentro do Grow a Garden 2. Gire, descubra seu prêmio e acompanhe tudo pelo site.",
      buttonLabel: "Abrir a roleta",
    },
    login: {
      eyebrow: null,
      title: "Entre para girar a roleta",
      description:
        "Identifique sua conta pelo Discord para salvar cada prêmio no seu inventário.",
      trustMessage:
        "Cada moeda custa R$ 1,00 no Pix e vale um giro. Os prêmios ficam no seu inventário e podem ser vendidos de volta por moedas.",
    },
    experience: {
      title: "Gire e descubra seu prêmio",
      description:
        "Cada moeda vale R$ 1,00 e paga um giro. Não gostou do prêmio? Venda de volta por moedas.",
    },
  };
}

export const ROULETTE_BRANDING = rouletteBrandingFor(
  STORE_SLUG,
  STORE_NAME,
  STORE_CATALOG_LABEL,
);
