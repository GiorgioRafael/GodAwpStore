import { describe, expect, it } from "vitest";

import { extractDiscordIdentity, parseAdminDiscordIds } from "@/lib/auth-identity";

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
