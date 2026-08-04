import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getMasterAdminSiteUrl: () => "https://101devs.com",
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { signInWithOAuth: mocks.signInWithOAuth },
  }),
}));

import { GET } from "./route";

describe("GET /auth/google/login", () => {
  beforeEach(() => {
    mocks.signInWithOAuth.mockReset();
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2/auth" },
      error: null,
    });
  });

  it("uses the exact allow-listed callback and carries next in the HttpOnly cookie", async () => {
    const response = await GET(
      new NextRequest(
        "https://101devs.com/auth/google/login?next=%2Fadmin%2Fdiscordbots",
      ),
    );

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://101devs.com/auth/callback",
        scopes: "openid email profile",
        queryParams: { prompt: "select_account" },
      },
    });
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/auth",
    );
    expect(response.cookies.get("gw_auth_next")?.value).toBe("/admin/discordbots");
  });
});
