import { describe, expect, it } from "vitest";

import { readLimitedBody, RequestBodyTooLargeError } from "./limited-body";

describe("readLimitedBody", () => {
  it("lê corpos dentro do limite", async () => {
    const request = new Request("https://example.test", { method: "POST", body: "seguro" });
    const body = await readLimitedBody(request, 6);
    expect(new TextDecoder().decode(body)).toBe("seguro");
  });

  it("interrompe streams sem Content-Length que ultrapassam o limite", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      }),
      // Required by Node for streaming request bodies; ignored by browsers.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readLimitedBody(request, 5)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
