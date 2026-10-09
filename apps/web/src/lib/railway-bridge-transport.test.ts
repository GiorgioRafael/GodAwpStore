// @vitest-environment node
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parse } from "node:url";
import { proxyRequest } from "next/dist/server/lib/router-utils/proxy-request";
import { addRequestMeta } from "next/dist/server/request-meta";
import { expect, it } from "vitest";

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

it("o proxy externo do Next preserva POST, bytes assinados, query, cookies e a origem pública", async () => {
  const signedBody = '{ "event": "payment.paid", "value": 5.00, "emoji": "🍎" }\n';
  const observed: { method?: string; url?: string; body?: Buffer; host?: string;
    forwardedHost?: string; cookie?: string; origin?: string; signature?: string } = {};
  const backend = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    Object.assign(observed, {
      method: request.method,
      url: request.url,
      body: Buffer.concat(chunks),
      host: request.headers.host,
      forwardedHost: request.headers["x-forwarded-host"],
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      signature: request.headers["x-signature"],
    });
    response.setHeader("set-cookie", "sb-pkce=refreshed; Path=/; HttpOnly; Secure; SameSite=Lax");
    response.end("forwarded");
  });
  const backendOrigin = await listen(backend);
  const bridge = createServer((request, response) => {
    // The Next route resolver records this before calling its HTTP proxy.
    addRequestMeta(request, "initQuery", parse(request.url ?? "/", true).query);
    void proxyRequest(request, response, parse(`${backendOrigin}${request.url}`, true))
      .catch(() => response.end());
  });
  const bridgeOrigin = await listen(bridge);
  try {
    const response = await new Promise<{ body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
      const outgoing = httpRequest(`${bridgeOrigin}/api/webhooks/payment?code=a%2Bb&tag=one&tag=two`, {
        method: "POST",
        headers: {
          host: "gwstore.vercel.app",
          "x-forwarded-host": "evil.example",
          cookie: "sb-pkce=original",
          origin: "https://gwstore.vercel.app",
          "x-signature": "signature-for-original-bytes",
          "content-type": "application/json",
        },
      }, async incoming => {
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        resolve({ body: Buffer.concat(chunks).toString(), headers: incoming.headers });
      });
      outgoing.on("error", reject);
      outgoing.end(signedBody);
    });
    expect(response.body).toBe("forwarded");
    expect(observed.method).toBe("POST");
    expect(observed.url).toBe("/api/webhooks/payment?code=a%2Bb&tag=one&tag=two");
    expect(observed.body).toEqual(Buffer.from(signedBody));
    expect(observed.host).toBe(new URL(backendOrigin).host);
    expect(observed.forwardedHost).toBe("gwstore.vercel.app");
    expect(observed.origin).toBe("https://gwstore.vercel.app");
    expect(observed.cookie).toBe("sb-pkce=original");
    expect(observed.signature).toBe("signature-for-original-bytes");
    expect(response.headers["set-cookie"]).toEqual(["sb-pkce=refreshed; Path=/; HttpOnly; Secure; SameSite=Lax"]);
  } finally {
    await close(bridge);
    await close(backend);
  }
});
