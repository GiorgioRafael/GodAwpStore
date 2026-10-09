import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("Railway health check", () => {
  it("is public liveness without credentials or internal state", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
