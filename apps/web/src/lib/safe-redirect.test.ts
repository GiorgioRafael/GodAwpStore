import { describe, expect, it } from "vitest";

import { safeInternalPath } from "./safe-redirect";

describe("safeInternalPath", () => {
  const origin = "https://painel.example.com";

  it("preserva apenas caminhos internos", () => {
    expect(safeInternalPath("/catalogo/produtos?status=active", origin)).toBe(
      "/catalogo/produtos?status=active",
    );
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "%2F%5Cevil.example/path",
  ])("bloqueia redirecionamento externo %s", (candidate) => {
    expect(safeInternalPath(candidate, origin)).toBe("/dashboard");
  });
});
