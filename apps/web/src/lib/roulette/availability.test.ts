import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/brand");
  vi.resetModules();
});

describe("roulette store isolation", () => {
  it.each([
    ["gwstore", false, true],
    ["godawp-store", false, true],
    ["thstore", true, true],
    ["unrelated-store", false, false],
  ])("%s allows new play=%s and old settlement=%s", async (slug, play, settle) => {
    vi.resetModules();
    vi.doMock("@/lib/brand", () => ({ STORE_SLUG: slug }));
    const availability = await import("./availability");
    expect(availability.ROULETTE_AVAILABLE).toBe(play);
    expect(availability.ROULETTE_LEGACY_SETTLEMENT_AVAILABLE).toBe(settle);
  });
});
