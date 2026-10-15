import "server-only";

export type ShopInformation = {
  supportUrl: string | null;
  supportLabel: string;
  hours: string | null;
  digitalDelivery: string | null;
  serviceDelivery: string | null;
  robuxDelivery: string | null;
  operatorName: string | null;
  operatorDocument: string | null;
  operatorAddress: string | null;
};

const label = (value: string | undefined) => value?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) || null;

/** Only public business information is returned; credentials never belong here. */
export function getShopInformation(): ShopInformation {
  const contact = label(process.env.GWSTORE_SUPPORT_URL);
  let supportUrl: string | null = null;
  if (contact) {
    try {
      const url = new URL(contact);
      if ((url.protocol === "https:" && !url.username && !url.password)
        || (url.protocol === "mailto:" && /^[^\s?@]+@[^\s?@]+\.[^\s?@]+$/.test(url.pathname) && !url.search)) {
        supportUrl = url.toString();
      }
    } catch { /* A malformed contact must never become a clickable link. */ }
  }
  return {
    supportUrl,
    supportLabel: label(process.env.GWSTORE_SUPPORT_LABEL) || "Falar com a GWStore",
    hours: label(process.env.GWSTORE_SUPPORT_HOURS),
    digitalDelivery: label(process.env.GWSTORE_DELIVERY_DIGITAL),
    serviceDelivery: label(process.env.GWSTORE_DELIVERY_SERVICES),
    robuxDelivery: label(process.env.GWSTORE_DELIVERY_ROBUX),
    operatorName: label(process.env.GWSTORE_OPERATOR_NAME),
    operatorDocument: label(process.env.GWSTORE_OPERATOR_DOCUMENT),
    operatorAddress: label(process.env.GWSTORE_OPERATOR_ADDRESS),
  };
}
