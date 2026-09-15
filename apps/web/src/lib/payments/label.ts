import { IS_GWSTORE } from "@/lib/brand";

export function paymentProviderLabel() {
  return IS_GWSTORE && process.env.PAYMENT_PROVIDER === "eclipsepay" ? "EclipsePay" : "LivePix";
}

export function currentPaymentCopy(text: string) {
  return paymentProviderLabel() === "EclipsePay" ? text.replace(/\blivepix\b/gi, "EclipsePay") : text;
}
