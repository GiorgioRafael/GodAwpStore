import "server-only";

import { LIVEPIX_MINIMUM_BRL_CENTS } from "./limits";

const DEFAULT_OAUTH_URL = "https://oauth.livepix.gg/oauth2/token";
const DEFAULT_API_URL = "https://api.livepix.gg";
const REQUIRED_SCOPES = "payments:write payments:read";
const REQUEST_TIMEOUT_MS = 10_000;

type Fetcher = typeof fetch;

type LivePixConfig = {
  clientId: string;
  clientSecret: string;
  oauthUrl?: string;
  apiUrl?: string;
};

export type LivePixCheckout = {
  reference: string;
  checkoutUrl: string;
};

export type LivePixPayment = {
  id: string;
  proof: string;
  reference: string;
  amountCents: number;
  currency: string;
  createdAt: string;
};

export class LivePixClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private accessTokenPromise: Promise<string> | null = null;

  constructor(
    private readonly config: LivePixConfig,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!config.clientId.trim() || !config.clientSecret.trim()) {
      throw new Error("Credenciais da LivePix não configuradas.");
    }
  }

  async createPayment(input: { amountCents: number; redirectUrl: string }): Promise<LivePixCheckout> {
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents < LIVEPIX_MINIMUM_BRL_CENTS
    ) {
      throw new Error("A cobrança LivePix deve ter pelo menos R$ 1,00.");
    }
    assertHttpUrl(input.redirectUrl, "URL de retorno da LivePix");

    const response = await this.authorizedFetch("/v2/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: input.amountCents,
        currency: "BRL",
        redirectUrl: input.redirectUrl,
      }),
    });
    if (response.status !== 201) {
      throw providerError("criar a cobrança", response.status);
    }

    const body: unknown = await response.json();
    const data = readObject(readObject(body)?.data);
    const reference = readNonEmptyString(data?.reference);
    const checkoutUrl = readNonEmptyString(data?.redirectUrl);
    if (!reference || !checkoutUrl) {
      throw new Error("A LivePix retornou uma cobrança incompleta.");
    }
    assertHttpsUrl(checkoutUrl, "URL de checkout da LivePix");

    return { reference, checkoutUrl };
  }

  async getPaymentByReference(reference: string): Promise<LivePixPayment> {
    const normalizedReference = reference.trim();
    if (!normalizedReference || normalizedReference.length > 255) {
      throw new Error("Referência de pagamento LivePix inválida.");
    }

    const query = new URLSearchParams({
      reference: normalizedReference,
      currency: "BRL",
      page: "1",
      limit: "2",
    });
    const response = await this.authorizedFetch(`/v2/payments?${query}`);
    if (!response.ok) {
      throw providerError("consultar o pagamento por referência", response.status);
    }

    const body: unknown = await response.json();
    const data = readObject(body)?.data;
    if (!Array.isArray(data)) {
      throw new Error("A LivePix retornou dados de pagamento inválidos.");
    }

    const matches = data.map(readPayment).filter(
      (payment) => payment.reference === normalizedReference,
    );
    if (matches.length !== 1) {
      throw new Error("A LivePix não retornou um pagamento único para a referência.");
    }
    return matches[0];
  }

  private async authorizedFetch(path: string, init: RequestInit = {}) {
    const token = await this.getAccessToken();
    const apiUrl = (this.config.apiUrl?.trim() || DEFAULT_API_URL).replace(/\/$/, "");
    return this.fetcher(`${apiUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async getAccessToken() {
    if (this.accessToken && this.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    this.accessTokenPromise ??= this.requestAccessToken().finally(() => {
      this.accessTokenPromise = null;
    });
    return this.accessTokenPromise;
  }

  private async requestAccessToken() {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId.trim(),
      client_secret: this.config.clientSecret.trim(),
      scope: REQUIRED_SCOPES,
    });
    const response = await this.fetcher(this.config.oauthUrl?.trim() || DEFAULT_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw providerError("autenticar", response.status);
    }

    const payload: unknown = await response.json();
    const data = readObject(payload);
    const accessToken = readNonEmptyString(data?.access_token);
    const expiresIn = data?.expires_in;
    if (!accessToken || !Number.isSafeInteger(expiresIn) || Number(expiresIn) < 60) {
      throw new Error("A LivePix retornou um token inválido.");
    }

    this.accessToken = accessToken;
    this.accessTokenExpiresAt = this.now() + Number(expiresIn) * 1_000;
    return accessToken;
  }
}

let livePixClient: LivePixClient | undefined;

export function getLivePixClient() {
  if (livePixClient) return livePixClient;

  const clientId = process.env.LIVEPIX_CLIENT_ID?.trim();
  const clientSecret = process.env.LIVEPIX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("LIVEPIX_CLIENT_ID ou LIVEPIX_CLIENT_SECRET não configurado.");
  }

  livePixClient = new LivePixClient({ clientId, clientSecret });
  return livePixClient;
}

function providerError(operation: string, status: number) {
  return new Error(`A LivePix recusou ${operation} (HTTP ${status}).`);
}

function assertHttpUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} inválida.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} inválida.`);
  }
}

function assertHttpsUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} inválida.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} deve usar HTTPS.`);
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPayment(value: unknown): LivePixPayment {
  const data = readObject(value);
  const id = readNonEmptyString(data?.id);
  const proof = readNonEmptyString(data?.proof);
  const reference = readNonEmptyString(data?.reference);
  const currency = readNonEmptyString(data?.currency);
  const createdAt = readNonEmptyString(data?.createdAt);
  const amountCents = data?.amount;
  if (
    !id ||
    !proof ||
    !reference ||
    currency !== "BRL" ||
    !createdAt ||
    !Number.isSafeInteger(amountCents) ||
    Number(amountCents) < 1
  ) {
    throw new Error("A LivePix retornou dados de pagamento inválidos.");
  }

  return {
    id,
    proof,
    reference,
    amountCents: Number(amountCents),
    currency,
    createdAt,
  };
}
