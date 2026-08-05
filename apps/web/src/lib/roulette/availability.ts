import { STORE_SLUG } from "@/lib/brand";

/**
 * Which deployments have the roulette.
 *
 * It was nine separate `STORE_SLUG !== "gwstore"` checks — the page, the
 * overlay, both sets of server actions, the promotion, the metrics panel, the
 * navigation and two login screens. Nine copies of one decision means turning
 * it on for a second store is nine chances to miss one, and the ones that get
 * missed are the server actions: the page opens, the wheel draws, and the spin
 * answers "this is only available on GWStore".
 *
 * A list rather than an env flag on purpose. The roulette needs its whole
 * schema — coins, spins, inventory, redemptions, overlay events — in that
 * store's own database, and a flag someone can flip in a dashboard would open
 * the page against a database that has none of it. Adding a store here is a
 * commit, which is the same review the migration goes through.
 */
const STORES_WITH_ROULETTE: ReadonlySet<string> = new Set(["gwstore"]);

export const ROULETTE_AVAILABLE = STORES_WITH_ROULETTE.has(STORE_SLUG);

/** The refusal a server action gives when the roulette is not this store's. */
export const ROULETTE_UNAVAILABLE_MESSAGE =
  "A roleta não está disponível nesta loja.";
