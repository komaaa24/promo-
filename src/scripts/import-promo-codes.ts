import { execFileSync } from "node:child_process";
import { AppDataSource } from "../database/data-source";
import { getCodeSuffix, hashPromoCode, normalizePromoCode } from "../promo/promo-code-utils";
import { env } from "../config/env";

const DEFAULT_BATCH_SIZE = 1000;

function getInputPath(): string {
  const inputPath = process.argv[2];

  if (!inputPath) {
    throw new Error("Usage: npm run promo:import -- /path/to/promocodes.xlsx");
  }

  return inputPath;
}

function extractPromoCodesFromXlsx(path: string): string[] {
  const worksheetXml = execFileSync("unzip", ["-p", path, "xl/worksheets/sheet1.xml"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const codes = new Set<string>();
  const cellRegex = /<[^:>]*(?::)?c\b[^>]*\br="B\d+"[^>]*>([\s\S]*?)<\/[^:>]*(?::)?c>/g;
  let match: RegExpExecArray | null;

  while ((match = cellRegex.exec(worksheetXml))) {
    const cellXml = match[1];
    const valueMatch =
      /<[^:>]*(?::)?t\b[^>]*>([^<]+)<\/[^:>]*(?::)?t>/.exec(cellXml) ??
      /<[^:>]*(?::)?v\b[^>]*>([^<]+)<\/[^:>]*(?::)?v>/.exec(cellXml);
    const code = valueMatch ? normalizePromoCode(valueMatch[1]) : null;

    if (code) {
      codes.add(code);
    }
  }

  return [...codes];
}

async function importBatch(batch: string[]): Promise<void> {
  const values: string[] = [];
  const params: Array<string | number> = [];

  batch.forEach((code, index) => {
    const offset = index * 3;
    values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
    params.push(hashPromoCode(code), getCodeSuffix(code), env.promo.defaultRewardAmount);
  });

  await AppDataSource.query(
    `
      INSERT INTO "promo_code_catalog" ("codeHash", "codeSuffix", "rewardAmount")
      VALUES ${values.join(", ")}
      ON CONFLICT ("codeHash") DO UPDATE
      SET
        "rewardAmount" = EXCLUDED."rewardAmount",
        "updatedAt" = now()
    `,
    params,
  );
}

async function main(): Promise<void> {
  const inputPath = getInputPath();
  const codes = extractPromoCodesFromXlsx(inputPath);

  if (codes.length === 0) {
    throw new Error("No promo codes found in the Excel file");
  }

  await AppDataSource.initialize();
  await AppDataSource.runMigrations();

  for (let index = 0; index < codes.length; index += DEFAULT_BATCH_SIZE) {
    await importBatch(codes.slice(index, index + DEFAULT_BATCH_SIZE));
    process.stdout.write(`Imported ${Math.min(index + DEFAULT_BATCH_SIZE, codes.length)} / ${codes.length}\r`);
  }

  process.stdout.write(`\nImported ${codes.length} unique promo codes\n`);
  await AppDataSource.destroy();
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);

  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }

  process.exit(1);
});
