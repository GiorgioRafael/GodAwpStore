import { describe, expect, it } from "vitest";

import { rouletteBrandingFor } from "./branding";

describe("roulette branding", () => {
  it("mantém a identidade histórica da GWStore", () => {
    const branding = rouletteBrandingFor(
      "gwstore",
      "GWStore",
      "Grow a Garden 2",
    );

    expect(branding.canonicalSiteUrl).toBe("https://gwstore.vercel.app");
    expect(branding.embedColor).toBe(0xd946ef);
    expect(branding.login.eyebrow).toBeNull();
    expect(branding.promotion.title).toBe("A roleta da GWStore chegou");
  });

  it("personaliza arte, copy, domínio e cor da THStore", () => {
    const branding = rouletteBrandingFor(
      "thstore",
      "THStore",
      "Grow a Garden 2",
    );

    expect(branding).toMatchObject({
      canonicalSiteUrl: "https://thstoreadm.vercel.app",
      bannerPath: "/brands/thstore-roulette-banner.png",
      embedColor: 0x2f7bf0,
      promotionMarker: "THStore • Grow a Garden 2 • roleta",
    });
    expect(JSON.stringify(branding)).not.toContain("GWStore");
    expect(branding.login.title).toContain("THStore");
    expect(branding.experience.title).toContain("THStore");
  });
});
