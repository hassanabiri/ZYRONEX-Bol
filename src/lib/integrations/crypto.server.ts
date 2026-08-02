import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Credential vault helpers. Integration secrets are encrypted with AES-256-GCM
 * before they touch the database and are never returned to the browser.
 */
function encryptionKey(): Buffer {
  const raw = process.env["INTEGRATION_CREDENTIAL_SECRET"];
  if (!raw) throw new Error("INTEGRATION_CREDENTIAL_SECRET is not set");
  return createHash("sha256").update(raw).digest();
}

export function encryptCredentials(payload: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptCredentials(stored: string): Record<string, string> {
  const buf = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as Record<string, string>;
}

/** Short, non-reversible identifier so the UI can show that a secret changed. */
export function fingerprint(payload: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
}

export function hashApiKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateApiKey(environment: string): { key: string; prefix: string } {
  const prefix = `zx_${environment === "production" ? "live" : "test"}_${randomBytes(3).toString("hex")}`;
  return { key: `${prefix}.${randomBytes(24).toString("base64url")}`, prefix };
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
