import { STORE_SLUG } from "@/lib/brand";

/** New spins, coin purchases, promotion and overlay are available only on THStore. */
const STORES_WITH_ROULETTE: ReadonlySet<string> = new Set(["thstore"]);

export const ROULETTE_AVAILABLE = STORES_WITH_ROULETTE.has(STORE_SLUG);

/** Existing payments and earned prizes must still be settled after GW closes the wheel. */
export const ROULETTE_LEGACY_SETTLEMENT_AVAILABLE = new Set([
  "gwstore",
  "godawp-store",
  "thstore",
]).has(STORE_SLUG);

/** The refusal a server action gives when the roulette is not this store's. */
export const ROULETTE_UNAVAILABLE_MESSAGE =
  "A roleta não está disponível nesta loja.";
