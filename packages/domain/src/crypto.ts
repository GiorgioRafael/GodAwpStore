import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const MINIMUM_HMAC_KEY_BYTES = 32;

export const encryptedSecretSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
});

export type EncryptedSecret = z.output<typeof encryptedSecretSchema>;
export type SecretKey = Buffer | Uint8Array;
export type AdditionalAuthenticatedData = string | Buffer | Uint8Array;

function asBuffer(value: SecretKey): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
function validateEncryptionKey(key: SecretKey): Buffer {
  const buffer = asBuffer(key);
  if (buffer.byteLength !== AES_KEY_BYTES) {
    throw new RangeError("A chave AES-256 deve possuir exatamente 32 bytes.");
  }
  return buffer;
}

function validateHmacKey(key: SecretKey): Buffer {
  const buffer = asBuffer(key);
  if (buffer.byteLength < MINIMUM_HMAC_KEY_BYTES) {
    throw new RangeError("A chave HMAC deve possuir pelo menos 32 bytes.");
  }
  return buffer;
}

function decodeCanonicalBase64(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new TypeError("A chave deve usar Base64 válido.");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) {
    throw new TypeError("A chave deve usar Base64 canônico.");
  }
  return decoded;
}

function aadToBuffer(aad: AdditionalAuthenticatedData | undefined): Buffer | undefined {
  if (aad === undefined) return undefined;
  return typeof aad === "string" ? Buffer.from(aad, "utf8") : Buffer.from(aad);
}

function decodePayloadPart(value: string, expectedBytes?: number): Buffer {
  const decoded = decodeCanonicalBase64(value);
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) {
    throw new TypeError("O conteúdo criptografado possui metadados inválidos.");
  }
  return decoded;
}

export function decodeEncryptionKey(base64Key: string): Buffer {
  return validateEncryptionKey(decodeCanonicalBase64(base64Key));
}

export function decodeHmacKey(base64Key: string): Buffer {
  return validateHmacKey(decodeCanonicalBase64(base64Key));
}

export function encryptSecret(
  plaintext: string,
  key: SecretKey,
  aad?: AdditionalAuthenticatedData,
): EncryptedSecret {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("O conteúdo secreto não pode ser vazio.");
  }

  const encryptionKey = validateEncryptionKey(key);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, {
    authTagLength: GCM_AUTH_TAG_BYTES,
  });
  const associatedData = aadToBuffer(aad);
  if (associatedData !== undefined) cipher.setAAD(associatedData);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(
  payload: EncryptedSecret,
  key: SecretKey,
  aad?: AdditionalAuthenticatedData,
): string {
  const parsed = encryptedSecretSchema.parse(payload);
  const encryptionKey = validateEncryptionKey(key);
  const iv = decodePayloadPart(parsed.iv, GCM_IV_BYTES);
  const authTag = decodePayloadPart(parsed.authTag, GCM_AUTH_TAG_BYTES);
  const ciphertext = decodePayloadPart(parsed.ciphertext);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, iv, {
    authTagLength: GCM_AUTH_TAG_BYTES,
  });
  const associatedData = aadToBuffer(aad);
  if (associatedData !== undefined) decipher.setAAD(associatedData);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Não foi possível autenticar ou descriptografar o conteúdo secreto.");
  }
}

export function fingerprintSecret(secret: string, key: SecretKey): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("O conteúdo secreto não pode ser vazio.");
  }
  return createHmac("sha256", validateHmacKey(key)).update(secret, "utf8").digest("hex");
}

export function fingerprintsEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
