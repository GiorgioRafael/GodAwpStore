import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LivePixClient } from "./client";

const config = {
  clientId: "11111111-1111-4111-8111-111111111111",
  clientSecret: "secret-value",
  oauthUrl: "https://oauth.example/token",
  apiUrl: "https://api.example",
};

describe("LivePixClient", () => {
  it("cria cobrança em centavos e reutiliza o token OAuth", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "token-value", expires_in: 3_600, token_type: "bearer" }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { data: { reference: "payment-ref", redirectUrl: "https://checkout.livepix.gg/payment-ref" } },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { data: { reference: "payment-ref-2", redirectUrl: "https://checkout.livepix.gg/payment-ref-2" } },
          { status: 201 },
        ),
      );
    const client = new LivePixClient(config, fetcher, () => 1_000_000);

    await expect(
      client.createPayment({ amountCents: 1_000, redirectUrl: "https://gwstore.vercel.app/pagamento/order" }),
    ).resolves.toEqual({
      reference: "payment-ref",
      checkoutUrl: "https://checkout.livepix.gg/payment-ref",
    });
    await client.createPayment({
      amountCents: 2_000,
      redirectUrl: "https://gwstore.vercel.app/pagamento/order-2",
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    const tokenBody = fetcher.mock.calls[0]?.[1]?.body;
    expect(tokenBody).toBeInstanceOf(URLSearchParams);
    expect(String(tokenBody)).toContain("scope=payments%3Awrite+payments%3Aread");
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: "Bearer token-value" });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      amount: 1_000,
      currency: "BRL",
      redirectUrl: "https://gwstore.vercel.app/pagamento/order",
    });
  });

  it("consulta e valida o pagamento recebido pela referência", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "token-value", expires_in: 3_600 }))
      .mockResolvedValueOnce(
        Response.json({
          data: [{
            id: "provider-payment-id",
            proof: "pix-proof",
            reference: "provider-reference",
            amount: 500,
            currency: "BRL",
            createdAt: "2026-07-16T12:00:00-03:00",
          }],
        }),
      );
    const client = new LivePixClient(config, fetcher);

    await expect(client.getPaymentByReference("provider-reference")).resolves.toEqual({
      id: "provider-payment-id",
      proof: "pix-proof",
      reference: "provider-reference",
      amountCents: 500,
      currency: "BRL",
      createdAt: "2026-07-16T12:00:00-03:00",
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      "https://api.example/v2/payments?reference=provider-reference&currency=BRL&page=1&limit=2",
    );
  });

  it("falha de forma fechada quando a referência não é única", async () => {
    const payment = {
      id: "provider-payment-id",
      proof: "pix-proof",
      reference: "provider-reference",
      amount: 500,
      currency: "BRL",
      createdAt: "2026-07-16T12:00:00-03:00",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "token-value", expires_in: 3_600 }))
      .mockResolvedValueOnce(Response.json({ data: [payment, { ...payment, id: "duplicate" }] }));
    const client = new LivePixClient(config, fetcher);

    await expect(client.getPaymentByReference("provider-reference")).rejects.toThrow(
      "pagamento único",
    );
  });

  it("colapsa emissões OAuth concorrentes no mesmo processo", async () => {
    let releaseToken: (() => void) | undefined;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    let paymentCalls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input: string | URL | Request): Promise<Response> => {
      if (String(input) === config.oauthUrl) {
        await tokenGate;
        return Response.json({ access_token: "shared-token", expires_in: 3_600 });
      }
      paymentCalls += 1;
      return Response.json(
        { data: { reference: `ref-${paymentCalls}`, redirectUrl: "https://checkout.livepix.gg/ref" } },
        { status: 201 },
      );
    });
    const client = new LivePixClient(config, fetcher);

    const first = client.createPayment({ amountCents: 100, redirectUrl: "https://gwstore.vercel.app/one" });
    const second = client.createPayment({ amountCents: 200, redirectUrl: "https://gwstore.vercel.app/two" });
    releaseToken?.();
    await Promise.all([first, second]);

    expect(fetcher.mock.calls.filter(([url]) => String(url) === config.oauthUrl)).toHaveLength(1);
  });

  it("falha de forma fechada para preço abaixo do mínimo e resposta incompleta", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "token-value", expires_in: 3_600 }))
      .mockResolvedValueOnce(Response.json({ data: {} }, { status: 201 }));
    const client = new LivePixClient(config, fetcher);

    await expect(
      client.createPayment({ amountCents: 99, redirectUrl: "https://gwstore.vercel.app/retorno" }),
    ).rejects.toThrow("pelo menos R$ 1,00");
    await expect(
      client.createPayment({ amountCents: 100, redirectUrl: "https://gwstore.vercel.app/retorno" }),
    ).rejects.toThrow("cobrança incompleta");
  });
});
