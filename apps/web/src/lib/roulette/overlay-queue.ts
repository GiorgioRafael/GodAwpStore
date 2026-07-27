/**
 * The overlay replays spins one at a time, so a busy minute has to queue. The
 * limit lives here because both the overlay page and the admin panel that hands
 * out its link have to agree on the same contract.
 */
export const OVERLAY_QUEUE_DEFAULT = 8;
export const OVERLAY_QUEUE_MINIMUM = 1;
export const OVERLAY_QUEUE_MAXIMUM = 50;

/** Query parameter the overlay page reads the limit from. */
export const OVERLAY_QUEUE_PARAM = "fila";

export function normalizeOverlayQueueLimit(value: string | number | undefined | null) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= OVERLAY_QUEUE_MINIMUM &&
    parsed <= OVERLAY_QUEUE_MAXIMUM
    ? parsed
    : OVERLAY_QUEUE_DEFAULT;
}

/**
 * Rewrites the queue size on an overlay link. The default is left implicit so
 * the copied address stays as short as possible.
 */
export function withOverlayQueueLimit(overlayUrl: string, limit: number) {
  const normalized = normalizeOverlayQueueLimit(limit);
  try {
    const url = new URL(overlayUrl);
    if (normalized === OVERLAY_QUEUE_DEFAULT) {
      url.searchParams.delete(OVERLAY_QUEUE_PARAM);
    } else {
      url.searchParams.set(OVERLAY_QUEUE_PARAM, String(normalized));
    }
    return url.toString();
  } catch {
    return overlayUrl;
  }
}
