import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STATE_TTL_SECONDS = 10 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]{12,32}$/;

export const GIVEAWAY_OAUTH_COOKIE = "gw_giveaway_oauth_state";

export function getGiveawayOAuthStateSecret() {
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret || secret.length < 16) {
    throw new Error("Segredo de assinatura OAuth não configurado.");
  }
  return secret;
}

export type GiveawayOAuthState = {
  version: 1;
  nonce: string;
  giveawayId: string;
  slug: string;
  referralToken: string | null;
  expiresAt: number;
};

export function createGiveawayOAuthState(
  input: { giveawayId: string; slug: string; referralToken?: string | null },
  secret: string,
  now = Date.now(),
) {
  assertSecret(secret);
  const state: GiveawayOAuthState = {
    version: 1,
    nonce: randomBytes(18).toString("base64url"),
    giveawayId: input.giveawayId,
    slug: input.slug,
    referralToken: input.referralToken ?? null,
    expiresAt: Math.floor(now / 1_000) + STATE_TTL_SECONDS,
  };
  assertState(state, now);
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyGiveawayOAuthState(
  token: string,
  secret: string,
  now = Date.now(),
): GiveawayOAuthState {
  assertSecret(secret);
  const [payload, receivedSignature, extra] = token.split(".");
  if (!payload || !receivedSignature || extra) throw new Error("OAuth state inválido.");
  const expectedSignature = signature(payload, secret);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("OAuth state inválido.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("OAuth state inválido.");
  }
  assertState(parsed, now);
  return parsed;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function assertSecret(secret: string) {
  if (secret.trim().length < 16) throw new Error("Segredo de assinatura OAuth inválido.");
}

function assertState(value: unknown, now: number): asserts value is GiveawayOAuthState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("nonce" in value) ||
    typeof value.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,40}$/.test(value.nonce) ||
    !("giveawayId" in value) ||
    typeof value.giveawayId !== "string" ||
    !UUID_PATTERN.test(value.giveawayId) ||
    !("slug" in value) ||
    typeof value.slug !== "string" ||
    !SLUG_PATTERN.test(value.slug) ||
    !("referralToken" in value) ||
    (value.referralToken !== null &&
      (typeof value.referralToken !== "string" || !UUID_PATTERN.test(value.referralToken))) ||
    !("expiresAt" in value) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt < Math.floor(now / 1_000) ||
    value.expiresAt > Math.floor(now / 1_000) + STATE_TTL_SECONDS + 5
  ) {
    throw new Error("OAuth state inválido.");
  }
}
