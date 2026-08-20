import { createHmac, timingSafeEqual } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { logger } from "../logger";
import { PaynetService } from "../payments/paynet-service";
import { decryptPromoCode, hashPromoCode, normalizePromoCode } from "../promo/promo-code-utils";

type QueryParam = string | number | boolean;

const sessionCookie = "promo_dash_session";
const sessionMaxAgeSeconds = 60 * 60 * 12;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string, statusCode = 200): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function credentials(): { username: string; password: string } | null {
  if (!env.admin.username || !env.admin.password) {
    return null;
  }

  return { username: env.admin.username, password: env.admin.password };
}

function signSession(value: string): string {
  const auth = credentials();
  const secret = auth ? `${auth.username}:${auth.password}` : "disabled";
  return createHmac("sha256", secret).update(value).digest("hex");
}

function createSessionCookie(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const value = `${issuedAt}`;
  return `${value}.${signSession(value)}`;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) {
    return {};
  }

  return Object.fromEntries(
    raw.split(";").map((cookie) => {
      const [key, ...value] = cookie.trim().split("=");
      return [key, value.join("=")];
    }),
  );
}

function isAuthenticated(req: IncomingMessage): boolean {
  const cookie = parseCookies(req)[sessionCookie];
  if (!cookie) {
    return false;
  }

  const [issuedAtRaw, signature] = cookie.split(".");
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isInteger(issuedAt) || !signature) {
    return false;
  }

  const age = Math.floor(Date.now() / 1000) - issuedAt;
  return age >= 0 && age <= sessionMaxAgeSeconds && safeEqual(signature, signSession(issuedAtRaw));
}

function setSession(res: ServerResponse): void {
  res.setHeader(
    "Set-Cookie",
    `${sessionCookie}=${createSessionCookie()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}`,
  );
}

function clearSession(res: ServerResponse): void {
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function requireDashboardAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!credentials()) {
    sendHtml(res, disabledHtml(), 503);
    return false;
  }

  if (!isAuthenticated(req)) {
    if (req.url?.startsWith("/dashboard/api")) {
      sendJson(res, 401, { ok: false, message: "Unauthorized" });
      return false;
    }

    redirect(res, "/dashboard/login");
    return false;
  }

  return true;
}

function parseLimit(url: URL, fallback = 50): number {
  const parsed = Number(url.searchParams.get("limit") ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : fallback;
}

function parsePage(url: URL): number {
  const parsed = Number(url.searchParams.get("page") ?? 1);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function buildFilters(url: URL, aliases: { dateColumn: string; regionColumn?: string; statusColumn?: string }): {
  where: string;
  params: QueryParam[];
} {
  const clauses: string[] = [];
  const params: QueryParam[] = [];

  const from = url.searchParams.get("from");
  if (from) {
    params.push(from);
    clauses.push(`${aliases.dateColumn} >= $${params.length}::date`);
  }

  const to = url.searchParams.get("to");
  if (to) {
    params.push(to);
    clauses.push(`${aliases.dateColumn} < ($${params.length}::date + interval '1 day')`);
  }

  const region = url.searchParams.get("region");
  if (region && aliases.regionColumn) {
    params.push(`%${region}%`);
    clauses.push(`${aliases.regionColumn} ILIKE $${params.length}`);
  }

  const status = url.searchParams.get("status");
  if (status && aliases.statusColumn) {
    params.push(status);
    clauses.push(`${aliases.statusColumn} = $${params.length}`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res: ServerResponse, filename: string, rows: Array<Record<string, unknown>>): void {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))]
    .filter(Boolean)
    .join("\n");

  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function appendPromoCodeSearch(clauses: string[], params: QueryParam[], q: string | null): void {
  const text = q?.trim();
  if (!text) {
    return;
  }

  const compact = text.replace(/[^a-zA-Z0-9]/g, "");
  const digits = text.replace(/\D/g, "");
  const parts: string[] = [];

  params.push(`%${text}%`);
  const textIndex = params.length;
  parts.push(
    `u."fullName" ILIKE $${textIndex}`,
    `u."phone" ILIKE $${textIndex}`,
    `u."telegramId"::text ILIKE $${textIndex}`,
    `c."id"::text ILIKE $${textIndex}`,
    `r."id"::text ILIKE $${textIndex}`,
    `p."id"::text ILIKE $${textIndex}`,
    `p."providerId"::text ILIKE $${textIndex}`,
    `p."providerUuid"::text ILIKE $${textIndex}`,
  );

  if (compact) {
    params.push(`%${compact.slice(-8)}%`);
    parts.push(`c."codeSuffix" ILIKE $${params.length}`);
  }

  const normalizedCode = normalizePromoCode(text);
  if (normalizedCode) {
    params.push(hashPromoCode(normalizedCode));
    parts.push(`c."codeHash" = $${params.length}`);
  }

  if (digits) {
    params.push(`%${digits}%`);
    const digitsIndex = params.length;
    parts.push(
      `u."telegramId"::text ILIKE $${digitsIndex}`,
      `regexp_replace(COALESCE(u."phone", ''), '\\D', '', 'g') LIKE $${digitsIndex}`,
    );
  }

  clauses.push(`(${parts.join(" OR ")})`);
}

function chartGroup(url: URL): "day" | "month" {
  return url.searchParams.get("group") === "month" ? "month" : "day";
}

async function getTimeSeries(
  dataSource: DataSource,
  url: URL,
  source: "redemptions" | "users",
): Promise<Array<Record<string, unknown>>> {
  const group = chartGroup(url);
  const step = group === "month" ? "1 month" : "1 day";
  const defaultWindow = group === "month" ? "11 months" : "29 days";
  const dateFormat = group === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const region = url.searchParams.get("region") || null;
  const dateColumn = source === "redemptions" ? 'r."createdAt"' : 'u."createdAt"';
  const fromSql =
    source === "redemptions"
      ? `"promo_code_redemptions" r JOIN "telegram_users" u ON u."id" = r."userId"`
      : `"telegram_users" u`;

  return dataSource.query(
    `
      WITH bounds AS (
        SELECT
          date_trunc('${group}', COALESCE($1::date, CURRENT_DATE - interval '${defaultWindow}')) AS start_at,
          date_trunc('${group}', COALESCE($2::date, CURRENT_DATE)) AS end_at
      ),
      buckets AS (
        SELECT generate_series(start_at, end_at, interval '${step}') AS bucket
        FROM bounds
      ),
      counts AS (
        SELECT date_trunc('${group}', ${dateColumn}) AS bucket, COUNT(*)::int AS count
        FROM ${fromSql}, bounds
        WHERE ${dateColumn} >= bounds.start_at
          AND ${dateColumn} < bounds.end_at + interval '${step}'
          AND ($3::text IS NULL OR u."address" ILIKE '%' || $3::text || '%')
        GROUP BY 1
      )
      SELECT to_char(buckets.bucket, '${dateFormat}') AS "date", COALESCE(counts.count, 0)::int AS "count"
      FROM buckets
      LEFT JOIN counts ON counts.bucket = buckets.bucket
      ORDER BY buckets.bucket
    `,
    [from, to, region],
  );
}

async function getOverview(dataSource: DataSource, url: URL): Promise<Record<string, unknown>> {
  const filters = buildFilters(url, { dateColumn: 'u."createdAt"', regionColumn: 'u."address"' });
  const redemptionFilters = buildFilters(url, { dateColumn: 'r."createdAt"', regionColumn: 'u."address"' });

  const [summary] = (await dataSource.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM "telegram_users" u ${filters.where}) AS "users",
        (SELECT COUNT(*)::int FROM "telegram_users" u ${filters.where.replace(/WHERE /, filters.where ? "WHERE " : "")}) AS "subscribers",
        (SELECT COUNT(*)::int FROM "telegram_users" u WHERE u."createdAt"::date = CURRENT_DATE) AS "todayUsers",
        (SELECT COUNT(*)::int FROM "promo_code_catalog") AS "totalCodes",
        (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "isActive" = true) AS "activeCodes",
        (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "isActive" = false) AS "blockedCodes",
        (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "rewardAmount" > 0) AS "winnerCodes",
        (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "rewardAmount" > 0 AND "redeemedAt" IS NULL) AS "availableWinnerCodes",
        (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "redeemedAt" IS NOT NULL) AS "redeemedCodes",
        (SELECT COUNT(*)::int FROM "promo_code_redemptions" r JOIN "telegram_users" u ON u."id" = r."userId" ${redemptionFilters.where}) AS "participants",
        (SELECT COUNT(*)::int FROM "promo_code_redemptions" r JOIN "telegram_users" u ON u."id" = r."userId" WHERE r."createdAt"::date = CURRENT_DATE) AS "todayRedemptions",
        (SELECT COUNT(DISTINCT r."userId")::int FROM "promo_code_redemptions" r JOIN "telegram_users" u ON u."id" = r."userId" ${redemptionFilters.where}) AS "uniqueParticipants",
        (SELECT COALESCE(SUM(r."rewardAmount"), 0)::int FROM "promo_code_redemptions" r JOIN "telegram_users" u ON u."id" = r."userId" ${redemptionFilters.where}) AS "acceptedRewardAmount",
        (SELECT COALESCE(SUM(p."amount"), 0)::int FROM "paynet_transactions" p WHERE p."status" = 'success') AS "successfulPaynetAmount",
        (SELECT COUNT(*)::int FROM "promo_code_redemptions" WHERE "status" = 'payout_failed') AS "failedPayouts",
        (SELECT COUNT(*)::int FROM "paynet_transactions" WHERE "status" IN ('pending', 'local_pending', 'unknown')) AS "pendingPayments"
    `,
    filters.params,
  )) as Array<Record<string, unknown>>;

  const dailyRedemptions = await getTimeSeries(dataSource, url, "redemptions");
  const dailyUsers = await getTimeSeries(dataSource, url, "users");
  const regionStats = await getRegions(dataSource, url);
  const codeBucketFilters = buildFilters(url, { dateColumn: 'r."createdAt"', regionColumn: 'u."address"' });
  const codeBuckets = await dataSource.query(
    `
    SELECT bucket, COUNT(*)::int AS "users"
    FROM (
      SELECT
        counted."id",
        CASE
          WHEN counted."codesUsed" = 1 THEN '1'
          WHEN counted."codesUsed" = 2 THEN '2'
          WHEN counted."codesUsed" BETWEEN 3 AND 5 THEN '3-5'
          WHEN counted."codesUsed" BETWEEN 6 AND 10 THEN '6-10'
          WHEN counted."codesUsed" BETWEEN 11 AND 50 THEN '11-50'
          ELSE '50+'
        END AS bucket
      FROM (
        SELECT u."id", COUNT(r."id")::int AS "codesUsed"
        FROM "telegram_users" u
        JOIN "promo_code_redemptions" r ON r."userId" = u."id"
        ${codeBucketFilters.where}
        GROUP BY u."id"
      ) counted
    ) buckets
    GROUP BY bucket
    ORDER BY CASE bucket
      WHEN '1' THEN 1
      WHEN '2' THEN 2
      WHEN '3-5' THEN 3
      WHEN '6-10' THEN 4
      WHEN '11-50' THEN 5
      ELSE 6
    END
  `,
    codeBucketFilters.params,
  );

  return { summary, dailyRedemptions, dailyUsers, regionStats, codeBuckets, group: chartGroup(url), serverTime: new Date().toISOString() };
}

async function getParticipants(dataSource: DataSource, url: URL): Promise<Record<string, unknown>> {
  const limit = parseLimit(url, 50);
  const offset = (parsePage(url) - 1) * limit;
  const filters = buildFilters(url, { dateColumn: 'u."createdAt"', regionColumn: 'u."address"', statusColumn: 'u."step"' });
  const q = url.searchParams.get("q");
  const params = [...filters.params];
  const clauses = filters.where ? [filters.where.slice("WHERE ".length)] : [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(u."fullName" ILIKE $${params.length} OR u."phone" ILIKE $${params.length} OR u."telegramId"::text ILIKE $${params.length})`);
  }

  const minCodes = Number(url.searchParams.get("minCodes") ?? "");
  const maxCodes = Number(url.searchParams.get("maxCodes") ?? "");
  const having: string[] = [];

  if (Number.isInteger(minCodes) && minCodes >= 0) {
    params.push(minCodes);
    having.push(`COUNT(r."id") >= $${params.length}`);
  }

  if (Number.isInteger(maxCodes) && maxCodes >= 0) {
    params.push(maxCodes);
    having.push(`COUNT(r."id") <= $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const havingSql = having.length ? `HAVING ${having.join(" AND ")}` : "";
  const [countRow] = await dataSource.query(
    `
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT u."id"
        FROM "telegram_users" u
        LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
        ${where}
        GROUP BY u."id"
        ${havingSql}
      ) filtered
    `,
    params,
  );
  params.push(limit, offset);

  const rows = await dataSource.query(
    `
      SELECT
        u."telegramId",
        u."fullName",
        u."phone",
        u."address",
        u."language",
        u."step",
        u."createdAt",
        COUNT(r."id")::int AS "codesUsed",
        COALESCE(SUM(r."rewardAmount"), 0)::int AS "rewardAmount",
        COUNT(p."id") FILTER (WHERE p."status" = 'failed')::int AS "failedPayments"
      FROM "telegram_users" u
      LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
      LEFT JOIN "paynet_transactions" p ON p."userId" = u."id"
      ${where}
      GROUP BY u."id"
      ${havingSql}
      ORDER BY "codesUsed" DESC, u."createdAt" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return { total: countRow.total, rows };
}

async function getParticipantDetail(dataSource: DataSource, telegramId: string): Promise<Record<string, unknown>> {
  const [participant] = (await dataSource.query(
    `
      SELECT
        u."id",
        u."telegramId",
        u."fullName",
        u."phone",
        u."address",
        u."language",
        u."step",
        u."createdAt",
        COUNT(r."id")::int AS "codesUsed",
        COALESCE(SUM(r."rewardAmount"), 0)::int AS "rewardAmount",
        COUNT(p."id") FILTER (WHERE p."status" = 'failed')::int AS "failedPayments"
      FROM "telegram_users" u
      LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
      LEFT JOIN "paynet_transactions" p ON p."userId" = u."id"
      WHERE u."telegramId" = $1
      GROUP BY u."id"
    `,
    [telegramId],
  )) as Array<Record<string, unknown>>;

  if (!participant) {
    throw new Error("Participant not found");
  }

  const codes = await dataSource.query(
    `
      SELECT
        r."createdAt",
        c."codeSuffix",
        c."codeEncrypted",
        r."rewardAmount",
        r."status" AS "redemptionStatus",
        r."errorMessage",
        p."status" AS "paynetStatus",
        p."providerId",
        p."providerUuid"
      FROM "promo_code_redemptions" r
      JOIN "promo_code_catalog" c ON c."id" = r."promoCodeId"
      LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
      WHERE r."userId" = $1
      ORDER BY r."createdAt" DESC
      LIMIT 500
    `,
    [participant.id],
  );

  return {
    participant,
    codes: codes.map((row: Record<string, unknown>) => ({
      ...row,
      code: decryptPromoCode(row.codeEncrypted as string | null) ?? row.codeSuffix,
      codeEncrypted: undefined,
    })),
  };
}

async function getCodes(dataSource: DataSource, url: URL): Promise<Record<string, unknown>> {
  const limit = parseLimit(url, 50);
  const offset = (parsePage(url) - 1) * limit;
  const params: QueryParam[] = [];
  const clauses: string[] = [];
  const q = url.searchParams.get("q");
  const status = url.searchParams.get("status");
  const mode = url.searchParams.get("mode") ?? "used";
  const effectiveMode = status === "available" || status === "blocked" ? "all" : mode;

  appendPromoCodeSearch(clauses, params, q);

  if (effectiveMode === "used") {
    clauses.push(`c."redeemedAt" IS NOT NULL`);
  }

  if (status === "winner") {
    clauses.push(`c."rewardAmount" > 0`);
  } else if (status === "used") {
    clauses.push(`c."redeemedAt" IS NOT NULL`);
  } else if (status === "available") {
    clauses.push(`c."redeemedAt" IS NULL AND c."isActive" = true`);
  } else if (status === "blocked") {
    clauses.push(`c."isActive" = false`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [summary] = await dataSource.query(
    `
    SELECT
      COUNT(DISTINCT c."id")::int AS "totalCodes",
      COUNT(DISTINCT c."id") FILTER (WHERE c."redeemedAt" IS NOT NULL)::int AS "usedCodes",
      COUNT(DISTINCT c."id") FILTER (WHERE c."redeemedAt" IS NULL)::int AS "unusedCodes",
      COUNT(DISTINCT c."id") FILTER (WHERE c."rewardAmount" > 0)::int AS "winnerCodes",
      COUNT(DISTINCT c."id") FILTER (WHERE c."isActive" = false)::int AS "blockedCodes"
    FROM "promo_code_catalog" c
    LEFT JOIN "promo_code_redemptions" r ON r."promoCodeId" = c."id"
    LEFT JOIN "telegram_users" u ON u."id" = COALESCE(c."redeemedByUserId", r."userId")
    LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
    ${where}
  `,
    params,
  );
  const [countRow] = await dataSource.query(
    `
      SELECT COUNT(DISTINCT c."id")::int AS total
      FROM "promo_code_catalog" c
      LEFT JOIN "promo_code_redemptions" r ON r."promoCodeId" = c."id"
      LEFT JOIN "telegram_users" u ON u."id" = COALESCE(c."redeemedByUserId", r."userId")
      LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
      ${where}
    `,
    params,
  );
  params.push(limit, offset);

  const rows = await dataSource.query(
    `
      SELECT
        c."id" AS "promoCodeId",
        c."codeSuffix",
        c."codeEncrypted",
        c."rewardAmount",
        c."isActive",
        c."redeemedAt",
        c."createdAt" AS "importedAt",
        r."id" AS "redemptionId",
        u."telegramId",
        u."fullName",
        u."phone",
        u."address",
        r."status" AS "redemptionStatus",
        r."errorMessage",
        p."status" AS "paynetStatus",
        p."amount" AS "paynetAmount",
        p."phone" AS "paynetPhone",
        p."providerId",
        p."providerUuid"
      FROM "promo_code_catalog" c
      LEFT JOIN "promo_code_redemptions" r ON r."promoCodeId" = c."id"
      LEFT JOIN "telegram_users" u ON u."id" = COALESCE(c."redeemedByUserId", r."userId")
      LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
      ${where}
      ORDER BY c."updatedAt" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return {
    total: countRow.total,
    summary,
    mode: effectiveMode,
    rows: rows.map((row: Record<string, unknown>) => ({
      ...row,
      code: decryptPromoCode(row.codeEncrypted as string | null) ?? row.codeSuffix,
      codeEncrypted: undefined,
    })),
  };
}

async function getRegions(dataSource: DataSource, url?: URL): Promise<Record<string, unknown>[]> {
  const filters = url ? buildFilters(url, { dateColumn: 'r."createdAt"', regionColumn: 'u."address"' }) : { where: "", params: [] };

  return dataSource.query(
    `
    SELECT
      COALESCE(NULLIF(split_part(u."address", ',', 1), ''), 'Noma''lum') AS "region",
      COUNT(DISTINCT u."id")::int AS "users",
      COUNT(r."id")::int AS "redemptions",
      COALESCE(SUM(r."rewardAmount"), 0)::int AS "rewardAmount",
      ROUND(COUNT(r."id")::numeric / GREATEST(COUNT(DISTINCT u."id"), 1), 2)::float AS "avgCodesPerUser",
      COUNT(p."id") FILTER (WHERE p."status" = 'failed')::int AS "failedPayments"
    FROM "telegram_users" u
    LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
    LEFT JOIN "paynet_transactions" p ON p."userId" = u."id"
    ${filters.where}
    GROUP BY 1
    ORDER BY "redemptions" DESC, "users" DESC
  `,
    filters.params,
  );
}

async function getPayments(dataSource: DataSource, url: URL): Promise<Record<string, unknown>> {
  const limit = parseLimit(url, 50);
  const offset = (parsePage(url) - 1) * limit;
  const filters = buildFilters(url, { dateColumn: 'p."createdAt"', regionColumn: 'u."address"', statusColumn: 'p."status"' });
  const params = [...filters.params, limit, offset];
  const [countRow] = await dataSource.query(
    `SELECT COUNT(*)::int AS total FROM "paynet_transactions" p JOIN "telegram_users" u ON u."id" = p."userId" ${filters.where}`,
    filters.params,
  );

  const rows = await dataSource.query(
    `
      SELECT
        p."createdAt",
        p."phone",
        p."amount",
        p."status",
        p."errorMessage",
        p."providerId",
        p."providerUuid",
        c."codeSuffix",
        u."telegramId",
        u."fullName",
        u."address"
      FROM "paynet_transactions" p
      JOIN "telegram_users" u ON u."id" = p."userId"
      LEFT JOIN "promo_code_redemptions" r ON r."id" = p."promoCodeRedemptionId"
      LEFT JOIN "promo_code_catalog" c ON c."id" = r."promoCodeId"
      ${filters.where}
      ORDER BY p."createdAt" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return { total: countRow.total, rows };
}

async function retryFailed(dataSource: DataSource, redemptionId?: string, limit = 20): Promise<Record<string, unknown>> {
  const rows = redemptionId
    ? [{ id: redemptionId }]
    : ((await dataSource.query(
        `
          SELECT "id"
          FROM "promo_code_redemptions"
          WHERE "status" = 'payout_failed'
          ORDER BY "createdAt" ASC
          LIMIT $1
        `,
        [limit],
      )) as Array<{ id: string }>);

  const paynetService = new PaynetService(dataSource);
  const results: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    try {
      const transaction = await paynetService.retryPromoPayout(row.id);
      results.push({ redemptionId: row.id, ok: transaction.status !== "failed", paynetStatus: transaction.status });
    } catch (error) {
      results.push({ redemptionId: row.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  logger.info("Dashboard retried failed payouts", { requested: rows.length, results });
  return { requested: rows.length, results };
}

async function exportRows(dataSource: DataSource, type: string, url: URL): Promise<Array<Record<string, unknown>>> {
  if (type === "participants") {
    const filters = buildFilters(url, { dateColumn: 'u."createdAt"', regionColumn: 'u."address"', statusColumn: 'u."step"' });
    const params = [...filters.params];
    const clauses = filters.where ? [filters.where.slice("WHERE ".length)] : [];
    const q = url.searchParams.get("q");
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(u."fullName" ILIKE $${params.length} OR u."phone" ILIKE $${params.length} OR u."telegramId"::text ILIKE $${params.length})`);
    }

    const minCodes = Number(url.searchParams.get("minCodes") ?? "");
    const maxCodes = Number(url.searchParams.get("maxCodes") ?? "");
    const having: string[] = [];
    if (Number.isInteger(minCodes) && minCodes >= 0) {
      params.push(minCodes);
      having.push(`COUNT(r."id") >= $${params.length}`);
    }
    if (Number.isInteger(maxCodes) && maxCodes >= 0) {
      params.push(maxCodes);
      having.push(`COUNT(r."id") <= $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const havingSql = having.length ? `HAVING ${having.join(" AND ")}` : "";
    return dataSource.query(
      `
        SELECT
          u."telegramId" AS "user_id",
          u."fullName" AS "ism_familiya",
          u."phone" AS "telefon",
          u."address" AS "hudud",
          u."language" AS "til",
          u."step" AS "holat",
          u."createdAt" AS "royxatdan_otgan",
          COUNT(r."id")::int AS "promokodlar_soni",
          COALESCE(SUM(r."rewardAmount"), 0)::int AS "yutuq_summa",
          COUNT(p."id") FILTER (WHERE p."status" = 'failed')::int AS "failed_paynet"
        FROM "telegram_users" u
        LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
        LEFT JOIN "paynet_transactions" p ON p."userId" = u."id"
        ${where}
        GROUP BY u."id"
        ${havingSql}
        ORDER BY u."createdAt" DESC
      `,
      params,
    );
  }

  if (type === "regions") {
    return getRegions(dataSource, url);
  }

  const params: QueryParam[] = [];
  const clauses: string[] = [];
  const q = url.searchParams.get("q");
  const region = url.searchParams.get("region");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status");
  const mode = url.searchParams.get("mode") ?? "used";
  const effectiveMode = status === "available" || status === "blocked" ? "all" : mode;

  appendPromoCodeSearch(clauses, params, q);
  if (region) {
    params.push(`%${region}%`);
    clauses.push(`u."address" ILIKE $${params.length}`);
  }
  if (from) {
    params.push(from);
    clauses.push(`COALESCE(c."redeemedAt", c."createdAt") >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    clauses.push(`COALESCE(c."redeemedAt", c."createdAt") < ($${params.length}::date + interval '1 day')`);
  }
  if (effectiveMode === "used") {
    clauses.push(`c."redeemedAt" IS NOT NULL`);
  }
  if (status === "winner") {
    clauses.push(`c."rewardAmount" > 0`);
  } else if (status === "available") {
    clauses.push(`c."redeemedAt" IS NULL AND c."isActive" = true`);
  } else if (status === "blocked") {
    clauses.push(`c."isActive" = false`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await dataSource.query(
    `
      SELECT
        c."codeEncrypted",
        c."codeSuffix",
        c."rewardAmount" AS "yutuq_summa",
        CASE
          WHEN c."redeemedAt" IS NOT NULL THEN 'kiritilgan'
          WHEN c."isActive" = false THEN 'bloklangan'
          ELSE 'kiritilmagan'
        END AS "promokod_holat",
        c."redeemedAt" AS "kiritilgan_vaqt",
        u."telegramId" AS "user_id",
        u."fullName" AS "ism_familiya",
        u."phone" AS "telefon",
        u."address" AS "hudud",
        r."status" AS "redemption_status",
        p."status" AS "paynet_status",
        p."providerId" AS "paynet_provider_id",
        r."errorMessage" AS "xato"
      FROM "promo_code_catalog" c
      LEFT JOIN "promo_code_redemptions" r ON r."promoCodeId" = c."id"
      LEFT JOIN "telegram_users" u ON u."id" = COALESCE(c."redeemedByUserId", r."userId")
      LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
      ${where}
      ORDER BY c."updatedAt" DESC
    `,
    params,
  );

  return rows.map((row: Record<string, unknown>) => {
    const { codeEncrypted, codeSuffix, ...rest } = row;

    return {
      promokod: decryptPromoCode(codeEncrypted as string | null) ?? codeSuffix,
      ...rest,
    };
  });
}

function loginHtml(error = ""): string {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Promo Panel Login</title><style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6f9;font-family:Arial,sans-serif;color:#20242a}
  form{width:min(380px,calc(100vw - 32px));background:white;border:1px solid #dfe3ea;border-radius:8px;padding:28px;box-shadow:0 16px 40px rgba(17,24,39,.08)}
  h1{margin:0 0 4px;font-size:30px;color:#c4002f} p{margin:0 0 24px;color:#4b5563} label{display:block;font-size:12px;font-weight:700;margin:14px 0 6px}
  input{width:100%;box-sizing:border-box;height:42px;border:1px solid #d1d5db;border-radius:7px;padding:0 12px;font-size:15px}
  button{width:100%;height:44px;margin-top:20px;border:0;border-radius:7px;background:#3159c9;color:white;font-weight:700;font-size:15px}
  .error{background:#fee2e2;color:#991b1b;border-radius:7px;padding:10px;margin-bottom:12px;font-size:14px}
  </style></head><body><form method="post" action="/dashboard/login"><h1>Promo Panel</h1><p>Boshqaruv tizimiga kirish</p>${error ? `<div class="error">${error}</div>` : ""}<label>LOGIN</label><input name="login" autocomplete="username" required/><label>PAROL</label><input name="password" type="password" autocomplete="current-password" required/><button>Kirish</button></form></body></html>`;
}

function disabledHtml(): string {
  return `<!doctype html><html><body><h2>Dashboard disabled</h2><p>DASH_LOGIN va DASH_PASS ni .env ichida sozlang.</p></body></html>`;
}

function dashboardHtml(): string {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Promo Panel</title><style>
  *{box-sizing:border-box} body{margin:0;background:#f5f6f8;color:#20242a;font-family:Arial,sans-serif} .app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}
  aside{background:#fff;border-right:1px solid #dde2ea;padding:28px 16px;position:sticky;top:0;height:100vh} .brand{font-size:30px;font-weight:800;color:#c4002f;margin-bottom:2px}.sub{font-size:12px;font-weight:700;margin-bottom:34px}
  nav button{display:flex;align-items:center;gap:12px;width:100%;height:48px;border:0;border-radius:8px;background:transparent;color:#293241;font-weight:700;font-size:16px;padding:0 18px;margin:4px 0;text-align:left;cursor:pointer}
  nav button.active{background:#3159c9;color:#fff}.user{position:absolute;bottom:24px;left:16px;right:16px;background:#f0f2f5;border-radius:8px;padding:14px;display:flex;gap:12px;align-items:center}.avatar{width:40px;height:40px;border-radius:50%;background:#c4002f;color:#fff;display:grid;place-items:center;font-weight:800}
  header{height:68px;background:#fff;border-bottom:1px solid #dde2ea;display:flex;align-items:center;justify-content:space-between;padding:0 32px;position:sticky;top:0;z-index:2}.title{font-size:22px;font-weight:800}.status{display:flex;gap:14px;align-items:center;font-size:13px;color:#4b5563}.dot{width:8px;height:8px;border-radius:50%;background:#40c979;display:inline-block}
  main{padding:32px;max-width:1540px}.filters,.panel{background:#fff;border:1px solid #dde2ea;border-radius:10px;padding:16px;margin-bottom:22px}.filters{display:grid;grid-template-columns:1.2fr repeat(4,minmax(130px,.5fr));gap:12px;align-items:end}.filter-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px}.chip{height:36px;border:1px solid #d7dce3;border-radius:18px;background:white;padding:0 14px;font-weight:800;cursor:pointer}.chip.active{background:#3159c9;color:white;border-color:#3159c9}
  label{font-size:11px;font-weight:800;color:#374151;display:block;margin-bottom:6px} input,select{width:100%;height:40px;border:1px solid #d7dce3;border-radius:7px;background:#f2f3f5;padding:0 12px;font-size:14px} .actions{display:flex;gap:8px}
  .btn{height:40px;border:0;border-radius:7px;background:#3159c9;color:white;font-weight:800;padding:0 14px;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}.btn.secondary{background:#e5e7eb;color:#1f2937}.btn.danger{background:#c4002f}.btn.ghost{background:#f3f4f6;color:#20242a}
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(190px,1fr));gap:16px}.card{background:#fff;border:1px solid #dde2ea;border-radius:10px;padding:18px;min-height:108px}.card.hot{border-left:4px solid #c4002f}.label{font-size:11px;font-weight:800;color:#374151;text-transform:uppercase}.value{font-size:28px;font-weight:900;margin-top:10px}.hint{font-size:12px;color:#6b7280;margin-top:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.chart{height:260px;width:100%}.chart.tall{height:340px}.chart.wide{height:300px}.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.tabs{display:flex;background:#f1f3f6;border-radius:8px;padding:4px}.tab{border:0;border-radius:6px;background:transparent;padding:6px 12px;font-weight:800}.tab.active.red{background:#c4002f;color:#fff}.tab.active.blue{background:#3159c9;color:#fff}.tab.active.green{background:#0ca750;color:#fff} table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde2ea;border-radius:10px;overflow:hidden} th,td{border-bottom:1px solid #e5e7eb;text-align:left;padding:11px 12px;font-size:14px;vertical-align:top} th{background:#eef0f3;font-weight:800}.badge{display:inline-block;border-radius:999px;background:#e8f7ee;color:#00843d;font-weight:800;padding:4px 9px;font-size:12px}.badge.bad{background:#fee2e2;color:#b91c1c}.money{color:#c4002f;font-weight:900}.muted{color:#6b7280}.hidden{display:none}.bar{height:10px;background:#edf0f3;border-radius:20px;overflow:hidden}.bar span{display:block;height:100%;background:#c4002f;border-radius:20px}.modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:10}.modal.hidden{display:none}.modal-card{width:min(820px,calc(100vw - 32px));max-height:86vh;overflow:auto;background:#fff;border-radius:12px;border:1px solid #d7dce3}.modal-head{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 24px;border-bottom:1px solid #e5e7eb}.modal-body{padding:20px 24px}.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stat{background:#f3f4f6;border:1px solid #d7dce3;border-radius:10px;padding:12px}.close{border:0;background:transparent;font-size:24px;cursor:pointer} pre{white-space:pre-wrap;background:#111827;color:#e5e7eb;border-radius:8px;padding:14px;max-height:380px;overflow:auto}
  @media(max-width:900px){.app{grid-template-columns:1fr} aside{position:static;height:auto}.user{position:static;margin-top:20px} header{padding:0 16px} main{padding:16px}.filters,.kpis,.grid2{grid-template-columns:1fr} table{display:block;overflow:auto}}
  </style></head><body><div class="app"><aside><div class="brand">Promo</div><div class="sub">BOSHQARUV PANELI</div><nav>
  <button class="active" data-view="participants">Ishtirokchilar</button><button data-view="codes">Kiritilgan promokodlar</button><button data-view="regions">Hududlar</button><button data-view="payments">Paynet</button><button data-view="export">Eksport</button>
  </nav><div class="user"><div class="avatar">A</div><div><b>Admin</b><div class="muted">Boshqaruvchi</div></div></div></aside><section><header><div class="title" id="pageTitle">Ishtirokchilar</div><div class="status"><span><i class="dot"></i> Jonli <b id="clock"></b></span><span>Yangilandi: <b id="updated">-</b></span><button class="btn ghost" onclick="logout()">Chiqish</button></div></header><main>
  <div class="filters"><div id="searchFilter" class="hidden"><label>QIDIRISH</label><input id="q" placeholder="Ism, telefon, user ID yoki promokod"/></div><div><label>HUDUD</label><select id="region"><option value="">Barcha hududlar</option><option>Andijon viloyati</option><option>Buxoro viloyati</option><option>Farg'ona viloyati</option><option>Jizzax viloyati</option><option>Xorazm viloyati</option><option>Namangan viloyati</option><option>Navoiy viloyati</option><option>Qashqadaryo viloyati</option><option>Samarqand viloyati</option><option>Sirdaryo viloyati</option><option>Surxondaryo viloyati</option><option>Toshkent viloyati</option><option>Toshkent shahri</option><option>Qoraqalpog'iston</option></select></div><div><label>SANADAN</label><input id="from" type="date"/></div><div><label>SANAGACHA</label><input id="to" type="date"/></div><div class="actions"><button class="btn" onclick="load()">Qo'llash</button><button class="btn secondary" onclick="clearFilters()">Tozalash</button></div></div>
  <div id="overview" class="view hidden"></div><div id="participants" class="view"></div><div id="codes" class="view hidden"></div><div id="regions" class="view hidden"></div><div id="payments" class="view hidden"></div><div id="export" class="view hidden"></div>
  </main></section></div><div id="modal" class="modal hidden"></div><script>
  const el=id=>document.getElementById(id);
  let current='participants'; const titles={overview:'Boshqaruv paneli',participants:'Ishtirokchilar',codes:'Kiritilgan promokodlar',regions:'Hududlar',payments:'Paynet nazorati',export:'Eksport'};
  let codesMode='used'; let codesStatus=''; let chartGroup='day'; const fmt=n=>Number(n||0).toLocaleString('ru-RU'); const kpi=v=>typeof v==='string'?v:fmt(v); const esc=v=>String(v??'').replace(/[&<>"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); const qs=(withSearch=true)=>{const p=new URLSearchParams({region:el('region').value,from:el('from').value,to:el('to').value}); if(withSearch)p.set('q',el('q').value); return p.toString()}; const statsQs=(withSearch=true)=>{const p=new URLSearchParams(qs(withSearch)); p.set('group',chartGroup); return p.toString()};
  async function api(path,opt){const r=await fetch(path,opt); if(r.status===401) location='/dashboard/login'; if(!r.ok) throw new Error(await r.text()); return r.json()}
  function syncFilters(){el('searchFilter').classList.toggle('hidden',current==='participants')} function setView(v){current=v; syncFilters(); document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v)); document.querySelectorAll('.view').forEach(e=>e.classList.add('hidden')); el(v).classList.remove('hidden'); el('pageTitle').textContent=titles[v]; load()}
  document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view)); function clearFilters(){el('q').value='';el('region').value='';el('from').value='';el('to').value='';load()} function logout(){fetch('/dashboard/logout',{method:'POST'}).then(()=>location='/dashboard/login')}
  function table(rows){if(!rows.length)return '<div class="panel muted">Malumot yoq</div>'; const keys=Object.keys(rows[0]); return '<table><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(r[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
  function date(v){return v?new Date(v).toLocaleString('ru-RU'):''} function day(v){return v?new Date(v).toLocaleDateString('ru-RU'):'-'} function time(v){return v?new Date(v).toLocaleTimeString('ru-RU'):'-'} function shortId(v){return v?String(v).slice(0,8):'-'} function statusBadge(v,ok='Kiritilgan'){return v?'<span class="badge">'+esc(ok)+'</span>':'<span class="badge bad">-</span>'} function paynetBadge(v){if(!v)return '-'; return '<span class="badge '+(v==='failed'?'bad':'')+'">'+esc(v)+'</span>'}
  function emptyChart(x,w,h){x.fillStyle='#6b7280';x.font='24px Arial';x.textAlign='center';x.fillText('Malumot yoq',w/2,h/2)}
  function drawGrid(x,w,h,l,t,r,b,max){x.strokeStyle='#e2e6ec';x.lineWidth=1;x.fillStyle='#60656f';x.font='20px Arial';x.textAlign='right';for(let i=0;i<=4;i++){let y=t+(h-t-b)*i/4,val=Math.round(max-(max*i/4));x.beginPath();x.moveTo(l,y);x.lineTo(w-r,y);x.stroke();x.fillText(String(val),l-10,y+7)}}
  function lineChart(id,rows,color){setTimeout(()=>{const c=el(id),x=c.getContext('2d'),ratio=window.devicePixelRatio||1,w=c.width=c.clientWidth*ratio,h=c.height=c.clientHeight*ratio,l=72,t=36,r=26,b=54,data=rows.map(v=>({date:v.date,count:Number(v.count||0)})),max=Math.max(1,...data.map(v=>v.count));x.clearRect(0,0,w,h);if(!data.length){emptyChart(x,w,h);return}drawGrid(x,w,h,l,t,r,b,max);const points=data.map((v,i)=>({x:l+(w-l-r)*i/Math.max(data.length-1,1),y:h-b-(h-t-b)*v.count/max,v}));x.beginPath();points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.lineTo(points[points.length-1].x,h-b);x.lineTo(points[0].x,h-b);x.closePath();x.fillStyle=color+'22';x.fill();x.beginPath();points.forEach((p,i)=>i?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.strokeStyle=color;x.lineWidth=4;x.stroke();points.filter(p=>p.v.count>0).slice(-8).forEach(p=>{x.fillStyle=color;x.beginPath();x.arc(p.x,p.y,5,0,Math.PI*2);x.fill()});x.fillStyle='#60656f';x.font='19px Arial';x.textAlign='center';[0,Math.floor((data.length-1)/2),data.length-1].forEach(i=>{const p=points[i]; if(p)x.fillText(p.v.date.slice(5),p.x,h-18)});},30)}
  function barChart(id,rows,color,labelKey='bucket',valueKey='users'){setTimeout(()=>{const c=el(id),x=c.getContext('2d'),ratio=window.devicePixelRatio||1,w=c.width=c.clientWidth*ratio,h=c.height=c.clientHeight*ratio,l=72,t=36,r=26,b=64,data=rows.map(v=>({label:String(v[labelKey]),value:Number(v[valueKey]||0)})),max=Math.max(1,...data.map(v=>v.value));x.clearRect(0,0,w,h);if(!data.length){emptyChart(x,w,h);return}drawGrid(x,w,h,l,t,r,b,max);const slot=(w-l-r)/Math.max(data.length,1),bw=Math.min(slot*.68,160);data.forEach((v,i)=>{let bh=(h-t-b)*v.value/max,px=l+slot*i+(slot-bw)/2,py=h-b-bh;x.fillStyle=color;x.beginPath();x.roundRect(px,py,bw,bh,10);x.fill();x.fillStyle='#3159c9';x.font='bold 20px Arial';x.textAlign='center';if(v.value>0)x.fillText(fmt(v.value),px+bw/2,py-10);x.fillStyle='#60656f';x.font='20px Arial';x.fillText(v.label,px+bw/2,h-22)});},30)}
  function horizontalChart(id,rows,color,labelKey='region',valueKey='redemptions'){setTimeout(()=>{const c=el(id),x=c.getContext('2d'),ratio=window.devicePixelRatio||1,w=c.width=c.clientWidth*ratio,h=c.height=c.clientHeight*ratio,l=230,t=42,r=70,b=32,data=rows.slice(0,12).map(v=>({label:String(v[labelKey]||'-'),value:Number(v[valueKey]||0)})),max=Math.max(1,...data.map(v=>v.value));x.clearRect(0,0,w,h);if(!data.length){emptyChart(x,w,h);return}const row=(h-t-b)/Math.max(data.length,1),barH=Math.min(row*.52,28);x.strokeStyle='#edf0f3';x.lineWidth=1;data.forEach((v,i)=>{let y=t+i*row+row/2-barH/2,bw=(w-l-r)*v.value/max;x.fillStyle='#60656f';x.font='18px Arial';x.textAlign='right';x.fillText(v.label.slice(0,24),l-16,y+barH*.75);x.fillStyle=color;x.beginPath();x.roundRect(l,y,bw,barH,12);x.fill();x.fillStyle='#3159c9';x.font='bold 18px Arial';x.textAlign='left';x.fillText(fmt(v.value),l+bw+8,y+barH*.75)});},30)}
  async function load(){try{el('updated').textContent=new Date().toLocaleString(); if(current==='overview')return overviewView(); if(current==='participants')return participantsView(); if(current==='codes')return codesView(); if(current==='regions')return regionsView(); if(current==='payments')return paymentsView(); if(current==='export')return exportView()}catch(e){el(current).innerHTML='<div class="panel"><b>Xatolik:</b> '+esc(e.message)+'</div>'}}
  function chartTabs(color){return '<div class="tabs"><button class="tab '+(chartGroup==='day'?'active '+color:'')+'" data-chart-group="day">Kunlik</button><button class="tab '+(chartGroup==='month'?'active '+color:'')+'" data-chart-group="month">Oylik</button></div>'} function bindChartTabs(){document.querySelectorAll('[data-chart-group]').forEach(b=>b.onclick=()=>{chartGroup=b.dataset.chartGroup;load()})}
  async function overviewView(){const d=await api('/dashboard/api/overview?'+statsQs()); const s=d.summary; el('overview').innerHTML='<div class="kpis">'+[['Jami obunachilar',s.users,'Start bosganlar'],['Bugungi obunachilar',s.todayUsers,'Bugun royxatdan otgan'],['Jami promokodlar',s.totalCodes,'Import qilingan'],['Yutuqli promokodlar',s.winnerCodes,'Pul tushadigan promokodlar'],['Bugungi promokodlar',s.todayRedemptions,'Bugun kiritilgan'],['Ishtirokchilar',s.uniqueParticipants,'Promokod kiritgan userlar'],['Mavjud yutuqlar',s.availableWinnerCodes,'Hali ishlatilmagan'],['Failed/Pending',s.failedPayouts+' / '+s.pendingPayments,'Operator nazorati']].map((a,i)=>'<div class="card '+(i===7?'hot':'')+'"><div class="label">'+a[0]+'</div><div class="value">'+kpi(a[1])+'</div><div class="hint">'+a[2]+'</div></div>').join('')+'</div><div class="grid2" style="margin-top:22px"><div class="panel"><div class="panel-head"><h3>Promokodlar dinamikasi</h3>'+chartTabs('red')+'</div><canvas class="chart" id="redChart"></canvas></div><div class="panel"><div class="panel-head"><h3>Yangi ishtirokchilar</h3>'+chartTabs('blue')+'</div><canvas class="chart" id="userChart"></canvas></div></div><div class="panel"><div class="panel-head"><h3>Obunachilar dinamikasi</h3>'+chartTabs('green')+'</div><canvas class="chart wide" id="wideUserChart"></canvas></div><div class="grid2"><div class="panel"><div class="panel-head"><h3>Hududlar boyicha</h3><div class="tabs"><button class="tab active red">Promokodlar soni</button></div></div><canvas class="chart tall" id="regionChart"></canvas></div><div class="panel"><h3>Promokodlar soni boyicha ishtirokchilar</h3><div class="hint">Masalan: 1 marta kiritganlar, 3-5 marta kiritganlar</div><canvas class="chart tall" id="bucketChart"></canvas></div></div>'; lineChart('redChart',d.dailyRedemptions,'#c4002f'); lineChart('userChart',d.dailyUsers,'#3159c9'); lineChart('wideUserChart',d.dailyUsers,'#0ca750'); horizontalChart('regionChart',d.regionStats,'#c4002f','region','redemptions'); barChart('bucketChart',d.codeBuckets,'#3159c9','bucket','users'); bindChartTabs()}
  function regionBars(rows){const max=Math.max(1,...rows.map(r=>Number(r.redemptions))); return '<table><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r.region)+'</b></td><td>'+fmt(r.users)+'</td><td class="money">'+fmt(r.redemptions)+'</td><td><div class="bar"><span style="width:'+Math.round(Number(r.redemptions)*100/max)+'%"></span></div></td></tr>').join('')+'</tbody></table>'}
  async function participantsView(){const stats=await api('/dashboard/api/overview?'+statsQs(false)); const s=stats.summary; const dashboard='<div class="kpis">'+[['Jami obunachilar',s.users,'Start bosganlar'],['Bugungi obunachilar',s.todayUsers,'Bugun royxatdan otgan'],['Jami promokodlar',s.totalCodes,'Import qilingan'],['Yutuqli promokodlar',s.winnerCodes,'Pul tushadigan promokodlar'],['Bugungi promokodlar',s.todayRedemptions,'Bugun kiritilgan'],['Ishtirokchilar',s.uniqueParticipants,'Promokod kiritgan userlar'],['Mavjud yutuqlar',s.availableWinnerCodes,'Hali ishlatilmagan'],['Failed/Pending',s.failedPayouts+' / '+s.pendingPayments,'Operator nazorati']].map((a,i)=>'<div class="card '+(i===7?'hot':'')+'"><div class="label">'+a[0]+'</div><div class="value">'+kpi(a[1])+'</div><div class="hint">'+a[2]+'</div></div>').join('')+'</div><div class="grid2" style="margin-top:22px"><div class="panel"><div class="panel-head"><h3>Promokodlar dinamikasi</h3>'+chartTabs('red')+'</div><canvas class="chart" id="participantsRedChart"></canvas></div><div class="panel"><div class="panel-head"><h3>Yangi ishtirokchilar</h3>'+chartTabs('blue')+'</div><canvas class="chart" id="participantsUserChart"></canvas></div></div><div class="panel"><div class="panel-head"><h3>Obunachilar dinamikasi</h3>'+chartTabs('green')+'</div><canvas class="chart wide" id="participantsWideUserChart"></canvas></div><div class="grid2"><div class="panel"><div class="panel-head"><h3>Hududlar boyicha</h3><div class="tabs"><button class="tab active red">Promokodlar soni</button></div></div><canvas class="chart tall" id="participantsRegionChart"></canvas></div><div class="panel"><h3>Promokodlar soni boyicha ishtirokchilar</h3><div class="hint">Masalan: 1 marta, 3-5 marta, 10+ marta kiritganlar</div><canvas class="chart tall" id="participantsBucketChart"></canvas></div></div>'; el('participants').innerHTML=dashboard; lineChart('participantsRedChart',stats.dailyRedemptions,'#c4002f'); lineChart('participantsUserChart',stats.dailyUsers,'#3159c9'); lineChart('participantsWideUserChart',stats.dailyUsers,'#0ca750'); horizontalChart('participantsRegionChart',stats.regionStats,'#c4002f','region','redemptions'); barChart('participantsBucketChart',stats.codeBuckets,'#3159c9','bucket','users'); bindChartTabs()}
  function closeModal(){el('modal').classList.add('hidden'); el('modal').innerHTML=''}
  function setCodesMode(v){codesMode=v; if(v==='used'&&(codesStatus==='available'||codesStatus==='blocked'))codesStatus=''; codesView()} function setCodesStatus(v){codesStatus=v; if(v==='available'||v==='blocked')codesMode='all'; codesView()}
  async function codesView(){const d=await api('/dashboard/api/codes?'+qs()+'&mode='+codesMode+(codesStatus?'&status='+codesStatus:'')); const s=d.summary; const modeTabs=[['used','Kiritilgan promokodlar'],['all','Barcha promokodlar']].map(x=>'<button class="chip '+(codesMode===x[0]?'active':'')+'" data-code-mode="'+x[0]+'">'+x[1]+'</button>').join(''); const statusTabs=[['','Hammasi'],['winner','Yutuqli'],['available','Kiritilmagan'],['blocked','Bloklangan']].map(x=>'<button class="chip '+(codesStatus===x[0]?'active':'')+'" data-code-status="'+x[0]+'">'+x[1]+'</button>').join(''); el('codes').innerHTML='<div class="kpis"><div class="card"><div class="label">Jami promokodlar</div><div class="value">'+fmt(s.totalCodes)+'</div></div><div class="card hot"><div class="label">Kiritilgan promokodlar</div><div class="value">'+fmt(s.usedCodes)+'</div></div><div class="card"><div class="label">Kiritilmagan</div><div class="value">'+fmt(s.unusedCodes)+'</div></div><div class="card"><div class="label">Yutuqli</div><div class="value">'+fmt(s.winnerCodes)+'</div></div></div><div class="panel"><div class="panel-head"><div><b>Jadval: '+fmt(d.total)+'</b><div class="hint">To‘liq promokod, user, vaqt va payout status ko‘rsatiladi. Eski importlarda to‘liq kod uchun Excelni qayta import qilish kerak.</div></div><a class="btn danger" href="/dashboard/export?type=codes">CSV yuklab olish</a></div><div class="filter-row"><b>Korinish:</b>'+modeTabs+'</div><div class="filter-row"><b>Status:</b>'+statusTabs+'</div></div>'+codesTable(d.rows); document.querySelectorAll('[data-code-mode]').forEach(b=>b.onclick=()=>setCodesMode(b.dataset.codeMode)); document.querySelectorAll('[data-code-status]').forEach(b=>b.onclick=()=>setCodesStatus(b.dataset.codeStatus||''))}
  function codesTable(rows){if(!rows.length)return '<div class="panel muted">Promokod topilmadi</div>'; return '<table><thead><tr><th>#</th><th>Promokod</th><th>Ishtirokchi</th><th>Telefon</th><th>Telegram ID</th><th>Hudud</th><th>Sana</th><th>Vaqt</th><th>Yutuq</th><th>Holat</th><th>Paynet</th><th>Provider</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td><b>'+esc(r.code)+'</b><div class="muted">ID: '+esc(shortId(r.promoCodeId))+'</div></td><td><b>'+esc(r.fullName||'-')+'</b></td><td>'+esc(r.phone||r.paynetPhone||'-')+'</td><td>'+esc(r.telegramId||'-')+'</td><td>'+esc(r.address||'-')+'</td><td>'+day(r.redeemedAt||r.importedAt)+'</td><td>'+time(r.redeemedAt||r.importedAt)+'</td><td class="money">'+fmt(r.rewardAmount)+'</td><td>'+(r.redeemedAt?statusBadge(true,'Kiritilgan'):(r.isActive?'<span class="badge bad">Kiritilmagan</span>':'<span class="badge bad">Bloklangan</span>'))+'<div class="muted">'+esc(r.redemptionStatus||'-')+'</div></td><td>'+paynetBadge(r.paynetStatus)+'<div class="muted">'+(r.paynetAmount?fmt(r.paynetAmount)+' so‘m':'')+'</div></td><td>'+esc(r.providerId||r.providerUuid||'-')+'<div class="muted">'+esc(r.errorMessage||'')+'</div></td></tr>').join('')+'</tbody></table>'}
  async function regionsView(){const rows=await api('/dashboard/api/regions'); el('regions').innerHTML='<div class="panel">'+table(rows)+'</div>'}
  async function paymentsView(){const d=await api('/dashboard/api/payments?'+qs()); el('payments').innerHTML='<div class="panel"><div class="panel-head"><div><b>Jami: '+fmt(d.total)+'</b><div class="hint">Paynet tranzaksiyalari, provider javoblari va xatolar nazorati.</div></div><button class="btn danger" onclick="retryFailedPaynet()">Failed payout retry</button></div></div>'+table(d.rows)}
  async function retryFailedPaynet(){if(!confirm('Failed payoutlar qayta yuborilsinmi?'))return; const result=await api('/dashboard/api/paynet/retry-failed',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); alert(JSON.stringify(result,null,2)); load()}
  function exportView(){el('export').innerHTML='<div class="grid2"><div class="panel"><h3>Filtrlar</h3><div class="hint">Yuqoridagi qidirish, hudud va sana filtrlariga qarab CSV tayyorlanadi. Ism, telefon, user ID yoki promokod yozib yuklab olish mumkin.</div><label>Malumot turi</label><select id="exportType"><option value="participants">Ishtirokchilar</option><option value="codes">Kiritilgan promokodlar</option><option value="regions">Hududlar statistikasi</option></select><label>Status</label><select id="exportStatus"><option value="">Hammasi</option><option value="winner">Yutuqli promokodlar</option><option value="available">Kiritilmagan promokodlar</option><option value="blocked">Bloklangan promokodlar</option></select><label>Promokodlar soni kamida</label><input id="exportMinCodes" type="number" min="0" placeholder="0"/></div><div class="panel"><h3>Yuklab olish</h3><p>Eksport real bazadan olinadi. Yangi import qilingan promokodlar to‘liq ko‘rinadi.</p><button class="btn danger" onclick="downloadExport()">CSV yuklab olish</button></div></div>'}
  function downloadExport(){const p=new URLSearchParams(qs()); const type=el('exportType').value; const status=el('exportStatus').value; const min=el('exportMinCodes').value; if(status)p.set('status',status); if(min)p.set('minCodes',min); location='/dashboard/export?type='+encodeURIComponent(type)+'&'+p.toString()}
  setInterval(()=>el('clock').textContent=new Date().toLocaleTimeString(),1000); setInterval(()=>load().catch(()=>{}),30000); load();
  </script></body></html>`;
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dataSource: DataSource,
): Promise<boolean> {
  if (!req.url?.startsWith("/admin") && !req.url?.startsWith("/dashboard")) {
    return false;
  }

  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/admin") {
      redirect(res, "/dashboard");
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/login") {
      if (!credentials()) {
        sendHtml(res, disabledHtml(), 503);
        return true;
      }
      sendHtml(res, loginHtml());
      return true;
    }

    if (req.method === "POST" && url.pathname === "/dashboard/login") {
      const auth = credentials();
      const body = new URLSearchParams(await readBody(req));
      if (!auth || !safeEqual(body.get("login") ?? "", auth.username) || !safeEqual(body.get("password") ?? "", auth.password)) {
        sendHtml(res, loginHtml("Login yoki parol noto'g'ri"), 401);
        return true;
      }
      setSession(res);
      redirect(res, "/dashboard");
      return true;
    }

    if (req.method === "POST" && url.pathname === "/dashboard/logout") {
      clearSession(res);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (!requireDashboardAuth(req, res)) {
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard") {
      sendHtml(res, dashboardHtml());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/overview") {
      sendJson(res, 200, await getOverview(dataSource, url));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/participants") {
      sendJson(res, 200, await getParticipants(dataSource, url));
      return true;
    }

    if (req.method === "GET" && url.pathname.startsWith("/dashboard/api/participants/")) {
      const telegramId = decodeURIComponent(url.pathname.slice("/dashboard/api/participants/".length));
      sendJson(res, 200, await getParticipantDetail(dataSource, telegramId));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/codes") {
      sendJson(res, 200, await getCodes(dataSource, url));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/regions") {
      sendJson(res, 200, await getRegions(dataSource, url));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/payments") {
      sendJson(res, 200, await getPayments(dataSource, url));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/dashboard/api/paynet/retry-failed") {
      const body = await readJson(req);
      const redemptionId = typeof body.redemptionId === "string" ? body.redemptionId : undefined;
      const limit = typeof body.limit === "number" ? body.limit : 20;
      sendJson(res, 200, await retryFailed(dataSource, redemptionId, limit));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/export") {
      const type = url.searchParams.get("type") ?? "codes";
      sendCsv(res, `${type}.csv`, await exportRows(dataSource, type, url));
      return true;
    }

    sendJson(res, 404, { ok: false, message: "Not found" });
    return true;
  } catch (error) {
    logger.error("Dashboard request failed", {
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 500, { ok: false, message: "Dashboard request failed" });
    return true;
  }
}
