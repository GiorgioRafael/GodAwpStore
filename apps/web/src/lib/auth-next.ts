/**
 * Where to land after the Discord round trip.
 *
 * The destination travels twice: in the callback URL and in this cookie. The
 * URL is the primary carrier, but it passes through Supabase and Discord, and
 * anything that rewrites the query string on the way back leaves the callback
 * with no destination at all. Falling back then means falling into the panel,
 * and the panel answers a player with "acesso não autorizado" — a login that
 * succeeded, reported as one that was refused.
 */
export const AUTH_NEXT_COOKIE = "gw_auth_next";

/** Long enough for a slow OAuth consent, short enough to not linger. */
export const AUTH_NEXT_MAX_AGE = 600;
