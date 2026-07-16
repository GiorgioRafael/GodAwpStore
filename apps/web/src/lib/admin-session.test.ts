import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  redirect: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { getAdminSession } from "@/lib/auth";

const discordId = "123456789012345678";
const authUserId = "27c79dc1-17ee-4738-aa3f-ea8489711d1d";
const discordUser = {
  id: authUserId,
  app_metadata: { provider: "discord" },
  aud: "authenticated",
  created_at: "2026-07-16T12:00:00.000Z",
  user_metadata: {},
  identities: [
    {
      id: discordId,
      user_id: authUserId,
      identity_id: discordId,
      provider: "discord",
      created_at: "2026-07-16T12:00:00.000Z",
      updated_at: "2026-07-16T12:00:00.000Z",
      last_sign_in_at: "2026-07-16T12:00:00.000Z",
      identity_data: {
        sub: discordId,
        global_name: "Administrador",
        avatar_url: "https://cdn.discordapp.com/avatar.png",
      },
    },
  ],
};

describe("getAdminSession", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: discordUser }, error: null })),
      },
    });
    mocks.single.mockResolvedValue({ data: { is_active: true }, error: null });
    mocks.select.mockReturnValue({ single: mocks.single });
    mocks.upsert.mockReturnValue({ select: mocks.select });
    mocks.from.mockReturnValue({ upsert: mocks.upsert });
    mocks.createAdminSupabaseClient.mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("nega um Discord ID autenticado que não esteja na lista administrativa", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "987654321098765432");

    await expect(getAdminSession()).resolves.toMatchObject({
      status: "unauthorized",
      identity: { discordId },
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("registra o perfil auditável e autoriza somente um Discord ID permitido", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", discordId);

    await expect(getAdminSession()).resolves.toMatchObject({
      status: "authorized",
      identity: { authUserId, discordId, displayName: "Administrador" },
    });
    expect(mocks.from).toHaveBeenCalledWith("admin_profiles");
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_user_id: authUserId,
        discord_user_id: discordId,
        display_name: "Administrador",
        avatar_url: "https://cdn.discordapp.com/avatar.png",
        authorization_expires_at: expect.any(String),
        last_login_at: expect.any(String),
      }),
      { onConflict: "auth_user_id" },
    );
  });

  it("falha de forma fechada quando o perfil administrativo não pode ser auditado", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", discordId);
    mocks.single.mockResolvedValue({ data: null, error: { code: "42501" } });

    await expect(getAdminSession()).resolves.toEqual({ status: "error", identity: null });
  });

  it("nega um perfil central desativado mesmo que o ID continue no ambiente", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", discordId);
    mocks.single.mockResolvedValue({ data: { is_active: false }, error: null });

    await expect(getAdminSession()).resolves.toMatchObject({
      status: "unauthorized",
      identity: { discordId },
    });
  });
});
