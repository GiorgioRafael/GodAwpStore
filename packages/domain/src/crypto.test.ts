import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeEncryptionKey,
  decodeHmacKey,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  fingerprintsEqual,
} from "./index";

describe("AES-256-GCM", () => {
  const key = Buffer.alloc(32, 7);
  const aad = "inventory-unit:123";

  it("criptografa e descriptografa conteúdo UTF-8 autenticado", () => {
    const encrypted = encryptSecret("usuário:senha:🔒", key, aad);

    expect(encrypted.algorithm).toBe("aes-256-gcm");
    expect(encrypted.version).toBe(1);
    expect(JSON.stringify(encrypted)).not.toContain("usuário");
    expect(decryptSecret(encrypted, key, aad)).toBe("usuário:senha:🔒");
  });

  it("usa IV aleatório em cada criptografia", () => {
    const first = encryptSecret("mesmo segredo", key, aad);
    const second = encryptSecret("mesmo segredo", key, aad);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejeita ciphertext adulterado", () => {
    const encrypted = encryptSecret("segredo", key, aad);
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;

    expect(() =>
      decryptSecret({ ...encrypted, ciphertext: ciphertext.toString("base64") }, key, aad),
    ).toThrow(/autenticar ou descriptografar/i);
  });

  it("vincula o conteúdo aos dados adicionais autenticados", () => {
    const encrypted = encryptSecret("segredo", key, aad);
    expect(() => decryptSecret(encrypted, key, "outra-unidade")).toThrow(
      /autenticar ou descriptografar/i,
    );
  });

  it("rejeita segredo vazio e chave com tamanho incorreto", () => {
    expect(() => encryptSecret("", key)).toThrow(/não pode ser vazio/i);
    expect(() => encryptSecret("segredo", Buffer.alloc(31))).toThrow(/32 bytes/i);
  });

  it("decodifica somente chave Base64 canônica com 32 bytes", () => {
    const encoded = key.toString("base64");
    expect(decodeEncryptionKey(encoded)).toEqual(key);
    expect(() => decodeEncryptionKey(Buffer.alloc(31).toString("base64"))).toThrow(/32 bytes/i);
    expect(() => decodeEncryptionKey("não-base64")).toThrow(/Base64/i);
  });
});
describe("fingerprint HMAC-SHA256", () => {
  const key = randomBytes(32);

  it("é determinístico com a mesma chave e distingue conteúdos", () => {
    const first = fingerprintSecret("segredo", key);
    const second = fingerprintSecret("segredo", key);
    const other = fingerprintSecret("outro", key);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(fingerprintsEqual(first, second)).toBe(true);
    expect(fingerprintsEqual(first, other)).toBe(false);
  });

  it("muda com outra chave", () => {
    expect(fingerprintSecret("segredo", key)).not.toBe(
      fingerprintSecret("segredo", randomBytes(32)),
    );
  });

  it("valida chave HMAC e comparação", () => {
    const encoded = key.toString("base64");
    expect(decodeHmacKey(encoded)).toEqual(key);
    expect(() => fingerprintSecret("segredo", Buffer.alloc(16))).toThrow(/pelo menos 32 bytes/i);
    expect(() => fingerprintSecret("", key)).toThrow(/não pode ser vazio/i);
    expect(fingerprintsEqual("inválido", "inválido")).toBe(false);
  });
});
