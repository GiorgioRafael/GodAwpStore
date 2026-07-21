import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createGiveawayOAuthState,
  giveawayEntryCookieName,
  verifyGiveawayOAuthState,
} from "./oauth-state";

const secret = "a-strong-discord-client-secret-for-tests";
const now = Date.parse("2026-07-20T18:00:00.000Z");

describe("giveaway OAuth state", () => {
  it("assina e recupera o sorteio e a indicação", () => {
    const token = createGiveawayOAuthState(
      {
        giveawayId: "11111111-1111-4111-8111-111111111111",
        slug: "abc123def456",
        referralToken: "22222222-2222-4222-8222-222222222222",
      },
      secret,
      now,
    );

    expect(verifyGiveawayOAuthState(token, secret, now)).toMatchObject({
      version: 2,
      giveawayId: "11111111-1111-4111-8111-111111111111",
      slug: "abc123def456",
      referralToken: "22222222-2222-4222-8222-222222222222",
      intent: "participate",
    });
  });

  it("assina o modo de consulta sem transformá-lo em participação", () => {
    const token = createGiveawayOAuthState(
      {
        giveawayId: "11111111-1111-4111-8111-111111111111",
        slug: "abc123def456",
        intent: "view",
      },
      secret,
      now,
    );

    expect(verifyGiveawayOAuthState(token, secret, now)).toMatchObject({
      version: 2,
      intent: "view",
      referralToken: null,
    });
    expect(giveawayEntryCookieName("abc123def456")).toBe(
      "gw_giveaway_entry_abc123def456",
    );
  });

  it("mantém estados da versão anterior como participação durante o deploy", () => {
    const payload = Buffer.from(JSON.stringify({
      version: 1,
      nonce: "legacy_state_nonce_123456",
      giveawayId: "11111111-1111-4111-8111-111111111111",
      slug: "abc123def456",
      referralToken: null,
      expiresAt: Math.floor(now / 1_000) + 600,
    })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");

    expect(verifyGiveawayOAuthState(`${payload}.${signature}`, secret, now)).toMatchObject({
      version: 1,
      intent: "participate",
    });
  });

  it("rejeita adulteração, expiração e segredo fraco", () => {
    const token = createGiveawayOAuthState(
      {
        giveawayId: "11111111-1111-4111-8111-111111111111",
        slug: "abc123def456",
      },
      secret,
      now,
    );
    const [payload, signature] = token.split(".");

    expect(() => verifyGiveawayOAuthState(`${payload}x.${signature}`, secret, now)).toThrow(
      "OAuth state inválido",
    );
    expect(() => verifyGiveawayOAuthState(token, secret, now + 11 * 60 * 1_000)).toThrow(
      "OAuth state inválido",
    );
    expect(() =>
      createGiveawayOAuthState(
        {
          giveawayId: "11111111-1111-4111-8111-111111111111",
          slug: "abc123def456",
        },
        "short",
        now,
      ),
    ).toThrow("Segredo de assinatura OAuth");
  });
});
