import { createHmac } from "node:crypto";
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
