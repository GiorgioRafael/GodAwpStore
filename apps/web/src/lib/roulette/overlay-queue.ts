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

/**
 * What paints behind the wheel. OBS composites a Browser Source with alpha, so
 * transparent is the right default and needs no filter. Captures that cannot do
 * alpha — TikTok Studio's window capture among them — get a flat green to key
 * out instead.
 */
export const OVERLAY_BACKGROUND_PARAM = "fundo";
export const OVERLAY_BACKGROUND_DEFAULT = "transparente";

export const OVERLAY_BACKGROUNDS = {
  transparente: "transparent",
  /** Pure green: what the OBS chroma key filter expects out of the box. */
  verde: "#00ff00",
  /** For a magenta-heavy wheel, keying green would eat the prize art. */
  magenta: "#ff00ff",
  preto: "#000000",
} as const;

export type OverlayBackground = keyof typeof OVERLAY_BACKGROUNDS;

export function normalizeOverlayBackground(value: string | undefined | null): OverlayBackground {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized in OVERLAY_BACKGROUNDS
    ? (normalized as OverlayBackground)
    : OVERLAY_BACKGROUND_DEFAULT;
}

/** Rewrites the background on an overlay link, leaving the default implicit. */
export function withOverlayBackground(overlayUrl: string, background: string) {
  const normalized = normalizeOverlayBackground(background);
  try {
    const url = new URL(overlayUrl);
    if (normalized === OVERLAY_BACKGROUND_DEFAULT) {
      url.searchParams.delete(OVERLAY_BACKGROUND_PARAM);
    } else {
      url.searchParams.set(OVERLAY_BACKGROUND_PARAM, normalized);
    }
    return url.toString();
  } catch {
    return overlayUrl;
  }
}

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
