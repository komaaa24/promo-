import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required env variable: ${name}`);
  }

  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number env variable: ${name}`);
  }

  return parsed;
}

export const env = {
  botToken: required("BOT_TOKEN"),
  nodeEnv: process.env.NODE_ENV ?? "development",
  addressStickerId: process.env.ADDRESS_STICKER_ID,
  successStickerId: process.env.SUCCESS_STICKER_ID,
  httpPort: optionalNumber("HTTP_PORT", 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  admin: {
    username: process.env.DASH_LOGIN ?? process.env.ADMIN_USERNAME,
    password: process.env.DASH_PASS ?? process.env.ADMIN_PASSWORD,
  },
  digitalPay: {
    baseUrl: process.env.DIGITAL_PAY_BASE_URL ?? "https://pay.adigital.uz",
    token: process.env.DIGITAL_PAY_TOKEN,
    username: process.env.DIGITAL_PAY_USERNAME,
    password: process.env.DIGITAL_PAY_PASSWORD,
    timeoutMs: optionalNumber("DIGITAL_PAY_TIMEOUT_MS", 15000),
    minAmount: optionalNumber("PAYNET_MIN_AMOUNT", 1000),
    maxAmount: optionalNumber("PAYNET_MAX_AMOUNT", 1000000),
  },
  promo: {
    codeSecret: process.env.PROMO_CODE_SECRET,
    defaultRewardAmount: optionalNumber("PROMO_DEFAULT_REWARD_AMOUNT", 0),
  },
  database: {
    host: process.env.DB_HOST ?? "localhost",
    port: optionalNumber("DB_PORT", 5432),
    username: process.env.DB_USERNAME ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    database: process.env.DB_NAME ?? "promo_bot",
  },
};
