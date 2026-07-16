import { describe, expect, it } from "vitest";

import {
  maskSecret,
  parseCsvInventory,
  parseInventoryImport,
  parseTxtInventory,
} from "./index";

describe("importação TXT", () => {
  it("lê uma unidade por linha, remove BOM, ignora linhas vazias e preserva a origem", () => {
    const result = parseTxtInventory("\uFEFF  CHAVE-1  \r\n\r\nCHAVE-2\n");

    expect(result.entries).toEqual([
      { lineNumber: 1, secret: "CHAVE-1" },
      { lineNumber: 3, secret: "CHAVE-2" },
    ]);
    expect(result.valid).toBe(true);
  });

  it("informa duplicidades sem copiá-las para o diagnóstico", () => {
    const result = parseInventoryImport("SEGREDO\noutro\nSEGREDO\nSEGREDO", "txt");

    expect(result.duplicates).toEqual([
      { firstLine: 1, duplicateLine: 3 },
      { firstLine: 1, duplicateLine: 4 },
    ]);
    expect(JSON.stringify(result.duplicates)).not.toContain("SEGREDO");
    expect(result.valid).toBe(false);
  });

  it("marca arquivo vazio como inválido", () => {
    const result = parseTxtInventory("\n  \r\n");
    expect(result.entries).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "empty_file", lineNumber: null }),
    );
    expect(result.valid).toBe(false);
  });
});
describe("importação CSV", () => {
  it("encontra a coluna secret independentemente da posição e lê aspas escapadas", () => {
    const result = parseCsvInventory(
      '\uFEFFproduto,SeCrEt,nota\r\nAWP,"login:senha,token",primeira\r\nAK,"texto com ""aspas""",segunda',
    );

    expect(result.entries).toEqual([
      { lineNumber: 2, secret: "login:senha,token" },
      { lineNumber: 3, secret: 'texto com "aspas"' },
    ]);
    expect(result.valid).toBe(true);
  });

  it("aceita quebra de linha dentro de campo entre aspas", () => {
    const result = parseCsvInventory('secret,note\n"linha 1\nlinha 2",ok\nfinal,ok');

    expect(result.entries).toEqual([
      { lineNumber: 2, secret: "linha 1\nlinha 2" },
      { lineNumber: 4, secret: "final" },
    ]);
    expect(result.valid).toBe(true);
  });

  it("exige a coluna secret", () => {
    const result = parseCsvInventory("codigo,nota\nabc,ok");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "missing_secret_column", lineNumber: 1 }),
    );
    expect(result.valid).toBe(false);
  });

  it("aponta secret vazio em linha preenchida", () => {
    const result = parseCsvInventory("secret,nota\n,sem segredo\nchave,ok");
    expect(result.entries).toEqual([{ lineNumber: 3, secret: "chave" }]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "empty_secret", lineNumber: 2 }),
    );
    expect(result.valid).toBe(false);
  });

  it("aponta aspas não fechadas", () => {
    const result = parseCsvInventory('secret\n"não fechado');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "malformed_csv", lineNumber: 2 }),
    );
    expect(result.valid).toBe(false);
  });
});

describe("mascaramento", () => {
  it("mostra apenas o sufixo solicitado", () => {
    expect(maskSecret("1234567890", 4)).toBe("••••••••7890");
    expect(maskSecret("abc", 4)).toBe("•••");
    expect(maskSecret("", 4)).toBe("");
    expect(() => maskSecret("secret", -1)).toThrow(/não negativo/i);
  });
});
