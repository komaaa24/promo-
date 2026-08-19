import { AppDataSource } from "../database/data-source";

async function main(): Promise<void> {
  await AppDataSource.initialize();

  const [summary] = await AppDataSource.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "telegram_users") AS "users",
      (SELECT COUNT(*)::int FROM "promo_code_catalog") AS "promoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "rewardAmount" > 0) AS "winnerPromoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "redeemedAt" IS NOT NULL) AS "redeemedPromoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "rewardAmount" > 0 AND "redeemedAt" IS NULL) AS "availableWinnerPromoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_redemptions" WHERE "status" = 'payout_failed') AS "failedPayouts",
      (SELECT COALESCE(SUM("amount"), 0)::int FROM "paynet_transactions" WHERE "status" = 'success') AS "successfulPaynetAmount"
  `);

  const paymentStatuses = await AppDataSource.query(`
    SELECT "status", COUNT(*)::int AS "count", COALESCE(SUM("amount"), 0)::int AS "amount"
    FROM "paynet_transactions"
    GROUP BY "status"
    ORDER BY "status"
  `);

  process.stdout.write(`${JSON.stringify({ summary, paymentStatuses }, null, 2)}\n`);
  await AppDataSource.destroy();
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }

  process.exit(1);
});
