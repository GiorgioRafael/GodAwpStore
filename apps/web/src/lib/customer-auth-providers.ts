import "server-only";

import { IS_GWSTORE } from "./brand";
import { getSupabasePublicConfig } from "./env";

export type CustomerAuthProviders = {
  google: boolean;
  discord: boolean;
  email: boolean;
};

const UNAVAILABLE: CustomerAuthProviders = { google: false, discord: false, email: false };

/** Only advertise providers enabled in this deployment's Auth project. */
export async function getCustomerAuthProviders(): Promise<CustomerAuthProviders> {
  if (!IS_GWSTORE) return { ...UNAVAILABLE };
  const config = getSupabasePublicConfig();
  if (!config) return { ...UNAVAILABLE };

  try {
    const response = await fetch(new URL("/auth/v1/settings", config.url), {
      headers: { apikey: config.publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { ...UNAVAILABLE };
    const settings: unknown = await response.json();
    if (!settings || typeof settings !== "object") return { ...UNAVAILABLE };
    const { external, mailer_autoconfirm } = settings as Record<string, unknown>;
    if (!external || typeof external !== "object") return { ...UNAVAILABLE };
    const providers = external as Record<string, unknown>;
    return {
      google: providers.google === true,
      discord: providers.discord === true,
      // Public settings do not attest SMTP delivery. Enable this flag only
      // after verifying a GWStore sender and confirmation/recovery delivery.
      email: process.env.GWSTORE_EMAIL_AUTH_ENABLED === "true"
        && providers.email === true && mailer_autoconfirm === false,
    };
  } catch {
    // Never leak provider responses, keys or configuration to the customer.
    return { ...UNAVAILABLE };
  }
}
