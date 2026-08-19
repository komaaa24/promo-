import { AppDataSource } from "../database/data-source";
import { PaynetService } from "../payments/paynet-service";

function getLimit(): number {
  const value = process.argv[2];

  if (!value) {
    return 20;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 500) {
    throw new Error("Usage: npm run paynet:retry-failed -- [limit]");
  }

  return parsed;
}

async function main(): Promise<void> {
  const limit = getLimit();
  await AppDataSource.initialize();

  const rows = (await AppDataSource.query(
    `
      SELECT "id"
      FROM "promo_code_redemptions"
      WHERE "status" = 'payout_failed'
      ORDER BY "createdAt" ASC
      LIMIT $1
    `,
    [limit],
  )) as Array<{ id: string }>;

  const paynetService = new PaynetService(AppDataSource);
  let success = 0;
  let failed = 0;

  for (const row of rows) {
    const transaction = await paynetService.retryPromoPayout(row.id);

    if (transaction.status === "failed") {
      failed += 1;
      process.stdout.write(`${row.id}: failed - ${transaction.errorMessage ?? "unknown error"}\n`);
    } else {
      success += 1;
      process.stdout.write(`${row.id}: ${transaction.status}\n`);
    }
  }

  process.stdout.write(`Retried ${rows.length}; success_or_pending=${success}; failed=${failed}\n`);
  await AppDataSource.destroy();
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }

  process.exit(1);
});
