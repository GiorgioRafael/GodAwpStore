import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMasterAdminSiteUrl } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.MASTER_ADMIN_SITE_URL;
});

describe("origem do painel mestre", () => {
  it("mantém o callback no domínio da 101Devs em produção", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getMasterAdminSiteUrl("https://gwstore.vercel.app")).toBe("https://101devs.com");
  });

  it("aceita uma origem administrativa HTTPS configurada", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.MASTER_ADMIN_SITE_URL = "https://admin.101devs.com/caminho";
    expect(getMasterAdminSiteUrl("https://gwstore.vercel.app")).toBe("https://admin.101devs.com");
  });

  it("preserva localhost no desenvolvimento", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getMasterAdminSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
});

