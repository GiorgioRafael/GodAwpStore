import { IS_GWSTORE } from "@/lib/brand";

export function paymentProviderLabel() {
  return IS_GWSTORE && process.env.PAYMENT_PROVIDER === "eclipsepay" ? "LivePix ou EclipsePay" : "LivePix";
}

export function currentPaymentCopy(text: string) {
  return paymentProviderLabel() === "LivePix ou EclipsePay"
    ? text.replace(/\b(?:LivePix ou EclipsePay|LivePix|EclipsePay)\b/gi, "LivePix ou EclipsePay")
    : text;
}
