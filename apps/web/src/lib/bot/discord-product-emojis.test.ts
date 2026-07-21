import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { discordProductImageSourceSha256 } from "./discord-product-emoji-shared";
import { synchronizeDiscordProductEmojis } from "./discord-product-emojis";

const productId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const applicationId = "123456789012345678";
const createdEmojiId = "423456789012345678";
const previousEmojiId = "323456789012345678";
const imageUrl =
  `https://project.supabase.co/storage/v1/object/public/catalog-media/products/${productId}.png`;
let pngFixture: Buffer;

describe("sincronização dos ícones de produto no Discord", () => {
  beforeAll(async () => {
    pngFixture = await sharp({
      create: {
        width: 32,
        height: 24,
        channels: 4,
        background: { r: 160, g: 50, b: 220, alpha: 0.8 },
      },
    })
      .png()
      .toBuffer();
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  });

  it("cria um emoji 128x128 e salva metadados idempotentes", async () => {
    const client = clientMock([productRow()]);
    const fetcher = emojiFetcher();

    await expect(
      synchronizeDiscordProductEmojis(client.value, fetcher),
    ).resolves.toMatchObject({ created: 1, replaced: 0, deleted: 0, failed: 0 });

    expect(client.update).toHaveBeenCalledWith({
      discord_application_emoji_id: createdEmojiId,
      discord_application_emoji_source_sha256:
        discordProductImageSourceSha256(imageUrl),
    });
    const createCall = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(createCall?.[1]?.body)) as { name: string; image: string };
    expect(body.name).toMatch(/^gw_[a-f0-9]{12}_[a-f0-9]{8}$/);
    expect(body.image).toMatch(/^data:image\/webp;base64,/);
    const webp = Buffer.from(body.image.split(",")[1] ?? "", "base64");
    await expect(sharp(webp).metadata()).resolves.toMatchObject({ width: 128, height: 128 });
  });

  it("não acessa rede nem banco quando a foto já está sincronizada", async () => {
    const client = clientMock([
      productRow({
        discord_application_emoji_id: previousEmojiId,
        discord_application_emoji_source_sha256:
          discordProductImageSourceSha256(imageUrl),
      }),
    ]);
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      synchronizeDiscordProductEmojis(client.value, fetcher),
    ).resolves.toMatchObject({ unchanged: 1, failed: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it("cria o novo emoji antes de substituir e limpar o antigo", async () => {
    const client = clientMock([
      productRow({
        discord_application_emoji_id: previousEmojiId,
        discord_application_emoji_source_sha256: "a".repeat(64),
      }),
    ]);
    const fetcher = emojiFetcher();

    await expect(
      synchronizeDiscordProductEmojis(client.value, fetcher),
    ).resolves.toMatchObject({ replaced: 1, failed: 0 });
    expect(fetcher.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "DELETE",
    ]);
  });

  it("remove o emoji quando a foto é desvinculada", async () => {
    const client = clientMock([
      productRow({
        image_url: null,
        discord_application_emoji_id: previousEmojiId,
        discord_application_emoji_source_sha256: "a".repeat(64),
      }),
    ]);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    await expect(
      synchronizeDiscordProductEmojis(client.value, fetcher),
    ).resolves.toMatchObject({ deleted: 1, failed: 0 });
    expect(client.update).toHaveBeenCalledWith({
      discord_application_emoji_id: null,
      discord_application_emoji_source_sha256: null,
    });
  });

  it("rejeita URL externa sem realizar requisição SSRF", async () => {
    const client = clientMock([productRow({ image_url: "https://example.com/item.png" })]);
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      synchronizeDiscordProductEmojis(client.value, fetcher),
    ).resolves.toMatchObject({ created: 0, failed: 1 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.update).not.toHaveBeenCalled();
  });

  it("mantém o produto salvo e informa falha quando Discord recusa o emoji", async () => {
    const client = clientMock([productRow()]);
    const fetcher = emojiFetcher({ discordStatus: 400 });

    const result = await synchronizeDiscordProductEmojis(client.value, fetcher);

    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect(result.failures[0]?.productId).toBe(productId);
    expect(client.update).not.toHaveBeenCalled();
  });
});

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    image_url: imageUrl,
    status: "active",
    archived_at: null,
    updated_at: "2026-07-20T12:00:00.000Z",
    discord_application_emoji_id: null,
    discord_application_emoji_source_sha256: null,
    ...overrides,
  };
}

function clientMock(rows: Array<Record<string, unknown>>) {
  const maybeSingle = vi.fn(async () => ({ data: { id: productId }, error: null }));
  const updateQuery = {
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle,
  };
  updateQuery.eq.mockReturnValue(updateQuery);
  updateQuery.select.mockReturnValue(updateQuery);
  const update = vi.fn(() => updateQuery);
  const value = {
    from: vi.fn(() => ({
      select: vi.fn(async () => ({ data: rows, error: null })),
      update,
    })),
  };
  return { value: value as never, update };
}

function emojiFetcher(options: { discordStatus?: number } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url === imageUrl) {
      const bytes = pngFixture.buffer.slice(
        pngFixture.byteOffset,
        pngFixture.byteOffset + pngFixture.byteLength,
      ) as ArrayBuffer;
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(pngFixture.length) },
      });
    }
    if (init?.method === "POST" && url.endsWith(`/applications/${applicationId}/emojis`)) {
      return options.discordStatus
        ? Response.json({ message: "Invalid Form Body" }, { status: options.discordStatus })
        : Response.json({ id: createdEmojiId, name: "product" });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`Requisição inesperada: ${url}`);
  });
}
