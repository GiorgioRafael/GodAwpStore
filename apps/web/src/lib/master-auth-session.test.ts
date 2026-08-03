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

import { getMasterAdminSession } from "@/lib/master-auth-session";

const authUserId = "27c79dc1-17ee-4738-aa3f-ea8489711d1d";
const googleUser = {
  id: authUserId,
  app_metadata: { provider: "google" },
  aud: "authenticated",
  created_at: "2026-08-03T12:00:00.000Z",
  user_metadata: {},
  identities: [
    {
      id: "google-identity",
      user_id: authUserId,
      identity_id: "google-identity",
      provider: "google",
      created_at: "2026-08-03T12:00:00.000Z",
      updated_at: "2026-08-03T12:00:00.000Z",
      last_sign_in_at: "2026-08-03T12:00:00.000Z",
      identity_data: {
        email: "jukersrx@gmail.com",
        email_verified: true,
        full_name: "Jukers RX",
        picture: "https://lh3.googleusercontent.com/avatar",
      },
    },
  ],
};

describe("getMasterAdminSession", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.createServerSupabaseClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: googleUser }, error: null })),
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

  it("autoriza e registra somente o Google e-mail permitido", async () => {
    vi.stubEnv("MASTER_ADMIN_GOOGLE_EMAILS", "jukersrx@gmail.com");

    await expect(getMasterAdminSession()).resolves.toMatchObject({
      status: "authorized",
      identity: {
        authUserId,
        email: "jukersrx@gmail.com",
        displayName: "Jukers RX",
      },
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_user_id: authUserId,
        google_email: "jukersrx@gmail.com",
        display_name: "Jukers RX",
        authorization_expires_at: expect.any(String),
      }),
      { onConflict: "auth_user_id" },
    );
  });

  it("nega outro e-mail Google antes de criar o perfil", async () => {
    vi.stubEnv("MASTER_ADMIN_GOOGLE_EMAILS", "outra@empresa.com");

    await expect(getMasterAdminSession()).resolves.toMatchObject({
      status: "unauthorized",
      identity: { email: "jukersrx@gmail.com" },
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("falha fechado se o perfil central não puder ser renovado", async () => {
    vi.stubEnv("MASTER_ADMIN_GOOGLE_EMAILS", "jukersrx@gmail.com");
    mocks.single.mockResolvedValue({ data: null, error: { code: "42501" } });

    await expect(getMasterAdminSession()).resolves.toEqual({
      status: "error",
      identity: null,
    });
  });
});
