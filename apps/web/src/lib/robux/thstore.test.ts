import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("uses THStore's rate, gamepass message, banner and payment return URL", async () => {
  vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "THStore");
  vi.resetModules();
  const { calculateRobuxPriceCents } = await import("./pricing");
  expect(calculateRobuxPriceCents(100)).toBe(350);
  expect(calculateRobuxPriceCents(1000)).toBe(3500);
  expect(calculateRobuxPriceCents(500000)).toBe(1750000);
  expect(calculateRobuxPriceCents(101)).toBe(354);
  const { createDiscordRobuxStorefrontPayload } = await import("../bot/discord-robux-storefront");
  const payload = createDiscordRobuxStorefrontPayload();
  expect(payload.embeds[0].fields[0].value).toBe("**1.000 Robux = R$ 35,00**");
  expect(payload.embeds[0].fields[1].value).toContain("gamepass");
  expect(payload.embeds[0].image.url).toBe("https://thstoreadm.vercel.app/brands/thstore-storefront-banner.png");
  expect(payload.embeds[0].footer.text).toContain("THStore");
  const { createNativeDiscordRobuxResponse } = await import("../bot/discord-robux");
  expect(createNativeDiscordRobuxResponse().type).toBe(9);
  const { robuxPaymentReturnUrl } = await import("./payment-service");
  expect(robuxPaymentReturnUrl("550e8400-e29b-41d4-a716-446655440000")).toBe("https://thstoreadm.vercel.app/pagamento/550e8400-e29b-41d4-a716-446655440000");
});
