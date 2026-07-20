import { describe, expect, it } from "vitest";

import {
  createGiveawayOAuthState,
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
      version: 1,
      giveawayId: "11111111-1111-4111-8111-111111111111",
      slug: "abc123def456",
      referralToken: "22222222-2222-4222-8222-222222222222",
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
