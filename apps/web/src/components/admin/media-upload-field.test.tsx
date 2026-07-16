import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MediaUploadField } from "./media-upload-field";

describe("MediaUploadField", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejeita arquivos fora de JPG, PNG ou WebP antes de chamar o servidor", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<MediaUploadField name="imageUrl" label="Imagem do produto" folder="products" />);

    await user.upload(
      screen.getByLabelText("Imagem do produto"),
      new File(["arquivo"], "produto.svg", { type: "image/svg+xml" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Use uma imagem JPG, PNG ou WebP.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia a imagem, mantém a URL no campo do formulário e permite desvincular", async () => {
    const user = userEvent.setup();
    const publicUrl = "https://example.supabase.co/storage/v1/object/public/catalog-media/products/item.png";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ path: "products/item.png", publicUrl }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { container } = render(
      <MediaUploadField name="imageUrl" label="Imagem do produto" folder="products" />,
    );

    await user.upload(
      screen.getByLabelText("Imagem do produto"),
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "produto.png", {
        type: "image/png",
      }),
    );

    expect(await screen.findByText(/Upload concluído/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/media",
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": expect.any(String) },
        body: expect.any(FormData),
      }),
    );
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(requestBody).toBeInstanceOf(FormData);
    expect((requestBody as FormData).get("folder")).toBe("products");
    expect((requestBody as FormData).get("file")).toBeInstanceOf(File);

    const hiddenInput = container.querySelector<HTMLInputElement>('input[name="imageUrl"]');
    expect(hiddenInput).toHaveValue(publicUrl);
    expect(screen.getByRole("link", { name: "Abrir imagem do produto" })).toHaveAttribute(
      "href",
      publicUrl,
    );

    await user.click(
      screen.getByRole("button", { name: "Remover imagem do produto do registro" }),
    );
    await waitFor(() => expect(hiddenInput).toHaveValue(""));
    expect(screen.getByText(/será desvinculada/)).toBeInTheDocument();
  });
});
