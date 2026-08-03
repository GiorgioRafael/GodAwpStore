import { describe, expect, it } from "vitest";

import {
  extractDiscordIdentity,
  extractGoogleIdentity,
  parseAdminDiscordIds,
  parseMasterAdminGoogleEmails,
} from "@/lib/auth-identity";

describe("parseAdminDiscordIds", () => {
  it("aceita apenas snowflakes válidos e remove duplicados", () => {
    expect([...parseAdminDiscordIds("123456789012345678, inválido,123456789012345678,987654321098765432")]).toEqual([
      "123456789012345678",
      "987654321098765432",
      "234486394414825472",
    ]);
  });

  it("mantém o proprietário do painel autorizado sem depender do ambiente", () => {
    expect(parseAdminDiscordIds(undefined)).toContain("234486394414825472");
  });
});

describe("extractDiscordIdentity", () => {
  it("usa a identidade OAuth do Discord e preserva IDs como texto", () => {
    const identity = extractDiscordIdentity({
      id: "auth-user",
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      user_metadata: {},
      identities: [
        {
          id: "identity",
          user_id: "auth-user",
          identity_id: "identity",
          provider: "discord",
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
          last_sign_in_at: new Date(0).toISOString(),
          identity_data: {
            sub: "123456789012345678",
            global_name: "Administrador",
            avatar_url: "https://cdn.discordapp.com/avatar.png",
          },
        },
      ],
    });

    expect(identity).toMatchObject({
      authUserId: "auth-user",
      discordId: "123456789012345678",
      displayName: "Administrador",
    });
  });

  it("rejeita metadata falsificada quando não existe identidade Discord", () => {
    const identity = extractDiscordIdentity({
      id: "auth-user",
      app_metadata: { provider: "email" },
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      user_metadata: {
        provider_id: "123456789012345678",
        sub: "123456789012345678",
        global_name: "Falso administrador",
      },
      identities: [
        {
          id: "email-identity",
          user_id: "auth-user",
          identity_id: "email-identity",
          provider: "email",
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
          last_sign_in_at: new Date(0).toISOString(),
          identity_data: { sub: "123456789012345678" },
        },
      ],
    });

    expect(identity).toBeNull();
  });
});

describe("identidade Google do painel mestre", () => {
  it("mantém somente e-mails válidos e normalizados na allowlist", () => {
    expect([
      ...parseMasterAdminGoogleEmails(
        " JUKERSRX@gmail.com, inválido,segunda@empresa.com,jukersrx@gmail.com ",
      ),
    ]).toEqual(["jukersrx@gmail.com", "segunda@empresa.com"]);
  });

  it("usa apenas uma identidade Google com e-mail confirmado", () => {
    const identity = extractGoogleIdentity({
      id: "google-auth-user",
      app_metadata: { provider: "google" },
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      user_metadata: {},
      identities: [
        {
          id: "google-identity",
          user_id: "google-auth-user",
          identity_id: "google-identity",
          provider: "google",
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
          last_sign_in_at: new Date(0).toISOString(),
          identity_data: {
            email: "JUKERSRX@gmail.com",
            email_verified: true,
            full_name: "Jukers RX",
            picture: "https://lh3.googleusercontent.com/avatar",
          },
        },
      ],
    });

    expect(identity).toEqual({
      authUserId: "google-auth-user",
      email: "jukersrx@gmail.com",
      displayName: "Jukers RX",
      avatarUrl: "https://lh3.googleusercontent.com/avatar",
    });
  });

  it("rejeita e-mail não confirmado e metadata sem identidade Google", () => {
    const baseUser = {
      id: "auth-user",
      app_metadata: { provider: "google" },
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      user_metadata: { email: "jukersrx@gmail.com", email_verified: true },
    };

    expect(extractGoogleIdentity({ ...baseUser, identities: [] })).toBeNull();
    expect(
      extractGoogleIdentity({
        ...baseUser,
        identities: [
          {
            id: "google-identity",
            user_id: "auth-user",
            identity_id: "google-identity",
            provider: "google",
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
            last_sign_in_at: new Date(0).toISOString(),
            identity_data: { email: "jukersrx@gmail.com", email_verified: false },
          },
        ],
      }),
    ).toBeNull();
  });
});
