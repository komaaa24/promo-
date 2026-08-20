import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env";

const PROMO_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function normalizePromoCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (compact.length !== 16) {
    return null;
  }

  const normalized = compact.match(/.{1,4}/g)?.join("-");

  return normalized && PROMO_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function assertPromoCodeSecret(): string {
  if (!env.promo.codeSecret || env.promo.codeSecret.length < 32) {
    throw new Error("PROMO_CODE_SECRET must be configured and at least 32 characters long");
  }

  return env.promo.codeSecret;
}

export function hashPromoCode(code: string): string {
  return createHmac("sha256", assertPromoCodeSecret()).update(code).digest("hex");
}

export function getCodeSuffix(code: string): string {
  return code.replace(/-/g, "").slice(-4);
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(assertPromoCodeSecret()).digest();
}

export function encryptPromoCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptPromoCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !encryptedRaw) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
