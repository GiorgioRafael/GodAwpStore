// @vitest-environment node

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ gw: true }));
const requestContext = vi.hoisted(() => ({ headers: new Headers({ host: "gwstoreofc.com" }) }));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return brand.gw; }, STORE_NAME: "GWStore" }));
vi.mock("next/headers", () => ({ headers: async () => requestContext.headers }));
vi.mock("@/components/shop/information-page", () => ({ StoreInformationPage: () => null }));

import { GET as robots } from "@/app/robots.txt/route";
import { GET as sitemap } from "@/app/sitemap.xml/route";
import { GET as socialImage } from "@/app/loja-compartilhar.png/route";
import { generateMetadata as supportMetadata } from "@/app/atendimento/page";
import { generateMetadata as termsMetadata } from "@/app/termos/page";
import { generateMetadata as privacyMetadata } from "@/app/privacidade/page";
import { generateMetadata as refundsMetadata } from "@/app/reembolsos/page";
import { SHOP_CANONICAL_ORIGIN, SHOP_PUBLIC_PATHS, shopHomeMetadata } from "./seo";

beforeEach(() => {
  brand.gw = true;
  requestContext.headers = new Headers({ host: "gwstoreofc.com" });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("publicação e compartilhamento da GWStore", () => {
  it("publica capa social e indexação somente para o domínio público da loja", async () => {
    const metadata = shopHomeMetadata(request(SHOP_CANONICAL_ORIGIN));
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates).toEqual({ canonical: SHOP_CANONICAL_ORIGIN });
    expect(metadata.openGraph).toMatchObject({ url: SHOP_CANONICAL_ORIGIN, locale: "pt_BR", type: "website",
      images: [{ url: `${SHOP_CANONICAL_ORIGIN}/loja-compartilhar.png`, width: 1200, height: 630 }] });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    const map = await sitemap(request(SHOP_CANONICAL_ORIGIN)).text();
    expect([...map.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]))
      .toEqual(SHOP_PUBLIC_PATHS.map(path => `${SHOP_CANONICAL_ORIGIN}${path === "/" ? "" : path}`));
    expect(map).not.toMatch(/admin|auth|compras|pagamento|cobrar|api/);
    const rules = await robots(request(SHOP_CANONICAL_ORIGIN)).text();
    expect(rules).toContain("Disallow: /\n");
    expect(rules).toContain("Allow: /$\n");
    expect(rules).toContain(`Sitemap: ${SHOP_CANONICAL_ORIGIN}/sitemap.xml`);
    expect(rules).not.toMatch(/Allow: \/(?:admin|auth|entrar|minhas-compras|api|pagamento|pagar|cobrar)/);
  });

  it.each(["https://101devs.com", "https://www.101devs.com", "https://thstoreadm.vercel.app", "https://preview.vercel.app", "http://localhost:3000"])(
    "não publica URLs GW nem capa em outro host: %s", async origin => {
      const req = request(origin, { "x-gwstore-public-host": "gwstoreofc.com", "x-forwarded-host": "gwstoreofc.com" });
      expect(shopHomeMetadata(req)).toMatchObject({ robots: { index: false, follow: false } });
      expect(shopHomeMetadata(req).openGraph).toBeUndefined();
      expect(shopHomeMetadata(req).alternates).toBeUndefined();
      expect(await robots(req).text()).toBe("User-agent: *\nDisallow: /\n");
      expect(await sitemap(req).text()).not.toContain("gwstore");
      expect((await socialImage(req)).status).toBe(404);
    },
  );

  it("não indexa o host legado de login e mantém a prévia apontando para o domínio canônico", async () => {
    const req = request("https://gwstore.vercel.app");
    expect(shopHomeMetadata(req)).toMatchObject({ robots: { index: false, follow: true },
      alternates: { canonical: SHOP_CANONICAL_ORIGIN }, openGraph: { url: SHOP_CANONICAL_ORIGIN } });
    expect(await robots(req).text()).not.toContain("Sitemap:");
    expect(await sitemap(req).text()).not.toContain("<loc>");
  });

  it("preserva a indexação pela ponte Railway validada e nunca pelo cabeçalho de master", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
    const req = request("https://gwstore-web-production.up.railway.app", { "x-gwstore-public-host": "www.gwstoreofc.com" });
    expect(shopHomeMetadata(req).robots).toEqual({ index: true, follow: true });
    expect(await sitemap(req).text()).toContain(`<loc>${SHOP_CANONICAL_ORIGIN}</loc>`);
    const master = request("https://gwstore-web-production.up.railway.app", { "x-gwstore-public-host": "101devs.com" });
    expect(await sitemap(master).text()).not.toContain("<loc>");
  });

  it("mantém THStore e outras marcas sem metadados ou indexação da GWStore", async () => {
    brand.gw = false;
    const req = request(SHOP_CANONICAL_ORIGIN);
    expect(shopHomeMetadata(req)).toEqual({ title: "Visão geral" });
    expect(await robots(req).text()).toBe("User-agent: *\nDisallow: /\n");
    expect(await sitemap(req).text()).not.toContain("gwstore");
    expect((await socialImage(req)).status).toBe(404);
  });

  it("renderiza uma capa PNG de 1200 × 630 usando a arte local da loja", async () => {
    const response = await socialImage(request(SHOP_CANONICAL_ORIGIN));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    const image = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(image).toMatchObject({ format: "png", width: 1200, height: 630 });
    // The image's noindex applies to its own response, never to the HTML page.
    expect(shopHomeMetadata(request(SHOP_CANONICAL_ORIGIN)).robots).toEqual({ index: true, follow: true });
    expect((await socialImage(request("https://101devs.com"))).status).toBe(404);
  });

  it("entrega a capa na Railway quando a ponte preserva o host público apesar do forwarded-host substituído", async () => {
    const railwayHost = "gwstore-web-production.up.railway.app";
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", railwayHost);
    vi.stubEnv("PORT", "8080");
    const response = await socialImage(new Request("http://0.0.0.0:8080/loja-compartilhar.png", { headers: {
      host: railwayHost, "x-forwarded-host": railwayHost, "x-forwarded-proto": "https",
      "x-gwstore-public-host": "gwstoreofc.com",
    } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata())
      .toMatchObject({ format: "png", width: 1200, height: 630 });
    for (const host of ["101devs.com", "thstoreadm.vercel.app", "evil.example"]) {
      expect((await socialImage(new Request("http://0.0.0.0:8080/loja-compartilhar.png", { headers: {
        host: railwayHost, "x-forwarded-host": railwayHost, "x-forwarded-proto": "https",
        "x-gwstore-public-host": host,
      } }))).status).toBe(404);
    }
  });

  it.each([
    ["/atendimento", supportMetadata], ["/termos", termsMetadata],
    ["/privacidade", privacyMetadata], ["/reembolsos", refundsMetadata],
  ] as const)("alinha canonical e robots de %s ao domínio e à marca da requisição", async (path, generateMetadata) => {
    for (const host of ["gwstoreofc.com", "www.gwstoreofc.com"]) {
      requestContext.headers = new Headers({ host });
      expect(await generateMetadata()).toMatchObject({ robots: { index: true, follow: true },
        alternates: { canonical: `${SHOP_CANONICAL_ORIGIN}${path}` } });
    }
    requestContext.headers = new Headers({ host: "gwstore.vercel.app" });
    expect(await generateMetadata()).toMatchObject({ robots: { index: false, follow: true },
      alternates: { canonical: `${SHOP_CANONICAL_ORIGIN}${path}` } });
    for (const host of ["101devs.com", "thstoreadm.vercel.app", "preview.vercel.app", "user@gwstoreofc.com", ""]) {
      requestContext.headers = new Headers({ host, "x-gwstore-public-host": "gwstoreofc.com", "x-forwarded-host": "gwstoreofc.com" });
      const metadata = await generateMetadata();
      expect(metadata.robots).toEqual({ index: false, follow: false });
      expect(metadata.alternates).toBeUndefined();
    }
    requestContext.headers = new Headers({ host: "gwstoreofc.com" });
    brand.gw = false;
    const otherBrand = await generateMetadata();
    expect(otherBrand.robots).toEqual({ index: false, follow: false });
    expect(otherBrand.alternates).toBeUndefined();
  });

  it("mantém canonical institucional pela ponte Railway validada", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
    requestContext.headers = new Headers({ host: "gwstore-web-production.up.railway.app", "x-gwstore-public-host": "gwstoreofc.com" });
    expect(await supportMetadata()).toMatchObject({ robots: { index: true, follow: true },
      alternates: { canonical: `${SHOP_CANONICAL_ORIGIN}/atendimento` } });
  });
});

function request(origin: string, headers?: Record<string, string>) {
  return new Request(`${origin}/`, { headers });
}
