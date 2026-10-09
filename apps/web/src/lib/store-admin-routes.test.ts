import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { brand } = vi.hoisted(() => ({ brand: { gw: true } }));
vi.mock("./brand", () => ({ get IS_GWSTORE() { return brand.gw; } }));
import { defaultStoreAdminPath, isGwStoreAdminOrigin, legacyStoreAdminRedirect, storeAdminHref, storeAdminRewritePath, storeAdminUrl } from "./store-admin-routes";

beforeEach(() => {
  brand.gw = true;
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
  vi.stubEnv("RAILWAY_STATIC_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("endereços do painel da GWStore", () => {
  it("prefixa somente URLs administrativas, preservando query e hash", () => {
    expect(storeAdminHref("/")).toBe("/admin");
    expect(storeAdminHref("/dashboard?period=today")).toBe("/admin?period=today");
    expect(storeAdminHref("/pedidos?status=paid")).toBe("/admin/pedidos?status=paid");
    expect(storeAdminHref("/configuracoes#vitrines")).toBe("/admin/configuracoes#vitrines");
    for (const publicPath of ["/sorteios/promo", "/pagar", "/pagamento/pix/token", "/roleta", "/api/admin/media", "/admin/gwstore", "/admin/pedidos"]) {
      expect(storeAdminHref(publicPath)).toBe(publicPath);
    }
  });

  it("reescreve apenas caminhos exatos do painel em origens conhecidas", () => {
    for (const origin of ["https://gwstoreofc.com", "https://www.gwstoreofc.com", "https://gwstore.vercel.app", "http://localhost:3000"]) {
      expect(storeAdminRewritePath("/admin", origin)).toBe("/dashboard");
      expect(storeAdminRewritePath("/admin/pedidos/", origin)).toBe("/pedidos");
      expect(defaultStoreAdminPath(origin)).toBe("/admin");
      expect(legacyStoreAdminRedirect("/pedidos", origin)).toBe("/admin/pedidos");
      expect(legacyStoreAdminRedirect("/admin/dashboard", origin)).toBe("/admin");
    }
    for (const path of ["/admin/gwstore", "/admin/discordbots", "/admin/loja-th", "/admin/sobremesas-fit", "/admin/sorteios/promo", "/admin/pedidos-antigos", "/admin//pedidos"]) {
      expect(storeAdminRewritePath(path, "https://gwstoreofc.com")).toBeNull();
    }
  });

  it("atualiza links absolutos do painel sem duplicar prefixo ou perder parâmetros", () => {
    expect(storeAdminUrl("https://gwstoreofc.com")).toBe("https://gwstoreofc.com/admin");
    expect(storeAdminUrl("https://gwstore.vercel.app/dashboard?period=today#resumo"))
      .toBe("https://gwstore.vercel.app/admin?period=today#resumo");
    expect(storeAdminUrl("https://gwstoreofc.com/admin")).toBe("https://gwstoreofc.com/admin");
    brand.gw = false;
    expect(storeAdminUrl("https://thstoreadm.vercel.app")).toBe("https://thstoreadm.vercel.app");
  });

  it("não troca o painel mestre nem aceita origens externas", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://101devs.com");
    for (const origin of ["https://101devs.com", "https://www.101devs.com", "https://externo.example", "javascript:alert(1)"]) {
      expect(isGwStoreAdminOrigin(origin)).toBe(false);
      expect(storeAdminRewritePath("/admin", origin)).toBeNull();
      expect(legacyStoreAdminRedirect("/pedidos", origin)).toBeNull();
    }
    vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://master.example.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://master.example.com");
    expect(isGwStoreAdminOrigin("https://master.example.com")).toBe(false);
  });

  it("inclui o domínio configurado e os aliases deste deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://loja.example.com/path");
    vi.stubEnv("VERCEL_URL", "gwstore-build123-team.vercel.app");
    expect(isGwStoreAdminOrigin("https://loja.example.com")).toBe(true);
    expect(isGwStoreAdminOrigin("https://gwstore-build123-team.vercel.app")).toBe(true);
  });

  it.each([
    ["RAILWAY_PUBLIC_DOMAIN", "gwstore-production.up.railway.app"],
    ["RAILWAY_STATIC_URL", "https://gwstore-production.up.railway.app"],
  ])("reconhece somente o domínio Railway exato configurado em %s", (variable, configured) => {
    vi.stubEnv(variable, configured);

    expect(isGwStoreAdminOrigin("https://gwstore-production.up.railway.app")).toBe(true);
    expect(storeAdminRewritePath("/admin", "https://gwstore-production.up.railway.app"))
      .toBe("/dashboard");
    for (const origin of [
      "https://other-project.up.railway.app",
      "https://child.gwstore-production.up.railway.app",
      "https://gwstore-production.up.railway.app.external.example",
    ]) {
      expect(isGwStoreAdminOrigin(origin)).toBe(false);
      expect(storeAdminRewritePath("/admin", origin)).toBeNull();
    }
  });

  it("mantém exclusão do master e ignora aliases Railway malformados", () => {
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "101devs.com");
    vi.stubEnv("RAILWAY_STATIC_URL", "ftp://external.example");

    expect(isGwStoreAdminOrigin("https://101devs.com")).toBe(false);
    expect(isGwStoreAdminOrigin("https://external.example")).toBe(false);
    expect(isGwStoreAdminOrigin("https://other-project.up.railway.app")).toBe(false);
  });

  it("mantém URLs e raiz da THStore", () => {
    brand.gw = false;
    expect(storeAdminHref("/")).toBe("/");
    expect(storeAdminHref("/pedidos?status=paid")).toBe("/pedidos?status=paid");
    expect(isGwStoreAdminOrigin("https://gwstoreofc.com")).toBe(false);
    expect(storeAdminRewritePath("/admin", "https://gwstoreofc.com")).toBeNull();
    expect(defaultStoreAdminPath("https://thstore.vercel.app")).toBe("/dashboard");
  });

  it("mapeia o atendimento de pedidos web e apenas filhos com UUID", () => {
    const path = "/atendimento-loja/10000000-0000-4000-8000-000000000001";
    expect(storeAdminHref(path)).toBe(`/admin${path}`);
    expect(storeAdminRewritePath(`/admin${path}`, "https://gwstoreofc.com")).toBe(path);
    expect(legacyStoreAdminRedirect(path, "https://gwstoreofc.com")).toBe(`/admin${path}`);
    expect(storeAdminRewritePath("/admin/atendimento-loja/aba-nova", "https://gwstoreofc.com")).toBeNull();
    expect(storeAdminRewritePath(`/admin${path}`, "https://101devs.com")).toBeNull();
    brand.gw = false;
    expect(storeAdminHref(path)).toBe(path);
    expect(storeAdminRewritePath(`/admin${path}`, "https://thstore.vercel.app")).toBeNull();
  });
});
