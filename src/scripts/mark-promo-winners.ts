import { AppDataSource } from "../database/data-source";
import { hashPromoCode, normalizePromoCode } from "../promo/promo-code-utils";

function parseArgs(): { amount: number; codes: string[] } {
  const amount = Number(process.argv[2]);
  const codes = process.argv.slice(3);

  if (!Number.isInteger(amount) || amount <= 0 || codes.length === 0) {
    throw new Error("Usage: npm run promo:winners -- <amount> <code1> <code2> ...");
  }

  return { amount, codes };
}

async function main(): Promise<void> {
  const { amount, codes } = parseArgs();
  const normalizedCodes = codes.map((code) => {
    const normalized = normalizePromoCode(code);

    if (!normalized) {
      throw new Error(`Invalid promo code format: ${code}`);
    }

    return normalized;
  });
  const hashes = normalizedCodes.map(hashPromoCode);

  await AppDataSource.initialize();

  const result = await AppDataSource.query(
    `
      UPDATE "promo_code_catalog"
      SET "rewardAmount" = $1, "updatedAt" = now()
      WHERE "codeHash" = ANY($2::char(64)[])
        AND "redeemedAt" IS NULL
    `,
    [amount, hashes],
  );

  await AppDataSource.destroy();

  process.stdout.write(`Marked ${result[1] ?? 0} promo codes as winners for ${amount}\n`);
  normalizedCodes.forEach((code) => process.stdout.write(`${code}\n`));
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }

  process.exit(1);
});
