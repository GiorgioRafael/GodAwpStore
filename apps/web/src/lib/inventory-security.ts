import "server-only";

import {
  decodeEncryptionKey,
  decodeHmacKey,
  decryptSecret,
  encryptSecret,
  fingerprintSecret,
  type EncryptedSecret,
} from "@godawp/domain";

function requiredKey(name: "INVENTORY_ENCRYPTION_KEY" | "INVENTORY_FINGERPRINT_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`A variável ${name} não foi configurada.`);
  return value;
}

export function protectInventorySecret(secret: string, productId: string) {
  const encryptionKey = decodeEncryptionKey(requiredKey("INVENTORY_ENCRYPTION_KEY"));
  const fingerprintKey = decodeHmacKey(requiredKey("INVENTORY_FINGERPRINT_KEY"));
  const encrypted = encryptSecret(secret, encryptionKey, productId);
  const fingerprintHex = fingerprintSecret(secret, fingerprintKey);

  return {
    encrypted,
    fingerprintBase64: Buffer.from(fingerprintHex, "hex").toString("base64"),
  };
}

export function fingerprintInventorySecret(secret: string): string {
  const key = decodeHmacKey(requiredKey("INVENTORY_FINGERPRINT_KEY"));
  return Buffer.from(fingerprintSecret(secret, key), "hex").toString("base64");
}

export function revealInventorySecret(payload: EncryptedSecret, productId: string): string {
  const key = decodeEncryptionKey(requiredKey("INVENTORY_ENCRYPTION_KEY"));
  return decryptSecret(payload, key, productId);
}
