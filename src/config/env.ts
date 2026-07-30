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
  database: {
    host: process.env.DB_HOST ?? "localhost",
    port: optionalNumber("DB_PORT", 5432),
    username: process.env.DB_USERNAME ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    database: process.env.DB_NAME ?? "promo_bot",
  },
};
