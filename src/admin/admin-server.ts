import { createHmac, timingSafeEqual } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { getRecentLogs, logger } from "../logger";
import { PaynetService } from "../payments/paynet-service";

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

  const dailyRedemptions = await dataSource.query(`
    SELECT to_char(day, 'YYYY-MM-DD') AS "date", COALESCE(counts.count, 0)::int AS "count"
    FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, interval '1 day') day
    LEFT JOIN (
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM "promo_code_redemptions"
      WHERE "createdAt" >= CURRENT_DATE - interval '29 days'
      GROUP BY 1
    ) counts ON counts.day = day
    ORDER BY day
  `);

  const dailyUsers = await dataSource.query(`
    SELECT to_char(day, 'YYYY-MM-DD') AS "date", COALESCE(counts.count, 0)::int AS "count"
    FROM generate_series(CURRENT_DATE - interval '29 days', CURRENT_DATE, interval '1 day') day
    LEFT JOIN (
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
      FROM "telegram_users"
      WHERE "createdAt" >= CURRENT_DATE - interval '29 days'
      GROUP BY 1
    ) counts ON counts.day = day
    ORDER BY day
  `);

  const regionStats = await getRegions(dataSource);
  const codeBuckets = await dataSource.query(`
    SELECT bucket, COUNT(*)::int AS "users"
    FROM (
      SELECT
        u."id",
        CASE
          WHEN COUNT(r."id") = 0 THEN '0'
          WHEN COUNT(r."id") = 1 THEN '1'
          WHEN COUNT(r."id") = 2 THEN '2'
          WHEN COUNT(r."id") BETWEEN 3 AND 5 THEN '3-5'
          WHEN COUNT(r."id") BETWEEN 6 AND 10 THEN '6-10'
          ELSE '10+'
        END AS bucket
      FROM "telegram_users" u
      LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
      GROUP BY u."id"
    ) buckets
    GROUP BY bucket
    ORDER BY bucket
  `);

  return { summary, dailyRedemptions, dailyUsers, regionStats, codeBuckets, serverTime: new Date().toISOString() };
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

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [countRow] = await dataSource.query(`SELECT COUNT(*)::int AS total FROM "telegram_users" u ${where}`, params);
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
      ORDER BY u."createdAt" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return { total: countRow.total, rows };
}

async function getCodes(dataSource: DataSource, url: URL): Promise<Record<string, unknown>> {
  const limit = parseLimit(url, 50);
  const offset = (parsePage(url) - 1) * limit;
  const params: QueryParam[] = [];
  const clauses: string[] = [];
  const q = url.searchParams.get("q");
  const status = url.searchParams.get("status");

  if (q) {
    params.push(`%${q.replace(/-/g, "").slice(-8)}%`);
    clauses.push(`c."codeSuffix" ILIKE $${params.length}`);
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
  const [countRow] = await dataSource.query(`SELECT COUNT(*)::int AS total FROM "promo_code_catalog" c ${where}`, params);
  params.push(limit, offset);

  const rows = await dataSource.query(
    `
      SELECT
        c."id",
        c."codeSuffix",
        c."rewardAmount",
        c."isActive",
        c."redeemedAt",
        u."telegramId",
        u."fullName",
        u."phone",
        r."status" AS "redemptionStatus",
        p."status" AS "paynetStatus"
      FROM "promo_code_catalog" c
      LEFT JOIN "telegram_users" u ON u."id" = c."redeemedByUserId"
      LEFT JOIN "promo_code_redemptions" r ON r."promoCodeId" = c."id"
      LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
      ${where}
      ORDER BY c."updatedAt" DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  );

  return { total: countRow.total, rows };
}

async function getRegions(dataSource: DataSource): Promise<Record<string, unknown>[]> {
  return dataSource.query(`
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
    GROUP BY 1
    ORDER BY "redemptions" DESC, "users" DESC
  `);
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
        p."id",
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

async function exportRows(dataSource: DataSource, type: string): Promise<Array<Record<string, unknown>>> {
  if (type === "participants") {
    return dataSource.query(`
      SELECT u."telegramId", u."fullName", u."phone", u."address", u."language", u."step", u."createdAt",
        COUNT(r."id")::int AS "codesUsed", COALESCE(SUM(r."rewardAmount"), 0)::int AS "rewardAmount"
      FROM "telegram_users" u
      LEFT JOIN "promo_code_redemptions" r ON r."userId" = u."id"
      GROUP BY u."id"
      ORDER BY u."createdAt" DESC
    `);
  }

  if (type === "payments") {
    return dataSource.query(`
      SELECT p."createdAt", p."phone", p."amount", p."status", p."errorMessage", p."providerId", p."providerUuid",
        c."codeSuffix", u."telegramId", u."fullName", u."address"
      FROM "paynet_transactions" p
      JOIN "telegram_users" u ON u."id" = p."userId"
      LEFT JOIN "promo_code_redemptions" r ON r."id" = p."promoCodeRedemptionId"
      LEFT JOIN "promo_code_catalog" c ON c."id" = r."promoCodeId"
      ORDER BY p."createdAt" DESC
    `);
  }

  return dataSource.query(`
    SELECT c."codeSuffix", c."rewardAmount", c."isActive", c."redeemedAt",
      u."telegramId", u."fullName", u."phone", r."status" AS "redemptionStatus", p."status" AS "paynetStatus"
    FROM "promo_code_catalog" c
    LEFT JOIN "telegram_users" u ON u."id" = c."redeemedByUserId"
    LEFT JOIN "promo_code_redemptions" r ON r."promoCodeId" = c."id"
    LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
    ORDER BY c."updatedAt" DESC
  `);
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
  main{padding:32px;max-width:1540px}.filters,.panel{background:#fff;border:1px solid #dde2ea;border-radius:10px;padding:16px;margin-bottom:22px}.filters{display:grid;grid-template-columns:1.2fr repeat(4,minmax(130px,.5fr));gap:12px;align-items:end}
  label{font-size:11px;font-weight:800;color:#374151;display:block;margin-bottom:6px} input,select{width:100%;height:40px;border:1px solid #d7dce3;border-radius:7px;background:#f2f3f5;padding:0 12px;font-size:14px} .actions{display:flex;gap:8px}
  .btn{height:40px;border:0;border-radius:7px;background:#3159c9;color:white;font-weight:800;padding:0 14px;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}.btn.secondary{background:#e5e7eb;color:#1f2937}.btn.danger{background:#c4002f}.btn.ghost{background:#f3f4f6;color:#20242a}
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(190px,1fr));gap:16px}.card{background:#fff;border:1px solid #dde2ea;border-radius:10px;padding:18px;min-height:108px}.card.hot{border-left:4px solid #c4002f}.label{font-size:11px;font-weight:800;color:#374151;text-transform:uppercase}.value{font-size:28px;font-weight:900;margin-top:10px}.hint{font-size:12px;color:#6b7280;margin-top:8px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.chart{height:260px;width:100%} table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde2ea;border-radius:10px;overflow:hidden} th,td{border-bottom:1px solid #e5e7eb;text-align:left;padding:11px 12px;font-size:14px;vertical-align:top} th{background:#eef0f3;font-weight:800}.badge{display:inline-block;border-radius:999px;background:#e8f7ee;color:#00843d;font-weight:800;padding:4px 9px;font-size:12px}.badge.bad{background:#fee2e2;color:#b91c1c}.money{color:#c4002f;font-weight:900}.muted{color:#6b7280}.hidden{display:none}.bar{height:10px;background:#edf0f3;border-radius:20px;overflow:hidden}.bar span{display:block;height:100%;background:#c4002f;border-radius:20px} pre{white-space:pre-wrap;background:#111827;color:#e5e7eb;border-radius:8px;padding:14px;max-height:380px;overflow:auto}
  @media(max-width:900px){.app{grid-template-columns:1fr} aside{position:static;height:auto}.user{position:static;margin-top:20px} header{padding:0 16px} main{padding:16px}.filters,.kpis,.grid2{grid-template-columns:1fr} table{display:block;overflow:auto}}
  </style></head><body><div class="app"><aside><div class="brand">Promo</div><div class="sub">BOSHQARUV PANELI</div><nav>
  <button class="active" data-view="overview">Boshqaruv paneli</button><button data-view="participants">Ishtirokchilar</button><button data-view="codes">Kodlar</button><button data-view="regions">Hududlar</button><button data-view="payments">Paynet</button><button data-view="export">Eksport</button><button data-view="logs">Loglar</button>
  </nav><div class="user"><div class="avatar">A</div><div><b>Admin</b><div class="muted">Boshqaruvchi</div></div></div></aside><section><header><div class="title" id="pageTitle">Boshqaruv paneli</div><div class="status"><span><i class="dot"></i> Jonli <b id="clock"></b></span><span>Yangilandi: <b id="updated">-</b></span><button class="btn ghost" onclick="logout()">Chiqish</button></div></header><main>
  <div class="filters"><div><label>QIDIRISH</label><input id="q" placeholder="Ism, telefon yoki user ID"/></div><div><label>HUDUD</label><input id="region" placeholder="Barcha hududlar"/></div><div><label>SANADAN</label><input id="from" type="date"/></div><div><label>SANAGACHA</label><input id="to" type="date"/></div><div class="actions"><button class="btn" onclick="load()">Qo'llash</button><button class="btn secondary" onclick="clearFilters()">Tozalash</button></div></div>
  <div id="overview" class="view"></div><div id="participants" class="view hidden"></div><div id="codes" class="view hidden"></div><div id="regions" class="view hidden"></div><div id="payments" class="view hidden"></div><div id="export" class="view hidden"></div><div id="logs" class="view hidden"></div>
  </main></section></div><script>
  let current='overview'; const titles={overview:'Boshqaruv paneli',participants:'Ishtirokchilar',codes:'Kodlar',regions:'Hududlar',payments:'Paynet nazorati',export:'Eksport',logs:'Loglar'};
  const fmt=n=>Number(n||0).toLocaleString('ru-RU'); const esc=v=>String(v??'').replace(/[&<>"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); const qs=()=>new URLSearchParams({q:q.value,region:region.value,from:from.value,to:to.value}).toString();
  async function api(path,opt){const r=await fetch(path,opt); if(r.status===401) location='/dashboard/login'; if(!r.ok) throw new Error(await r.text()); return r.json()}
  function setView(v){current=v; document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v)); document.querySelectorAll('.view').forEach(e=>e.classList.add('hidden')); document.getElementById(v).classList.remove('hidden'); pageTitle.textContent=titles[v]; load()}
  document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view)); function clearFilters(){q.value='';region.value='';from.value='';to.value='';load()} function logout(){fetch('/dashboard/logout',{method:'POST'}).then(()=>location='/dashboard/login')}
  function table(rows){if(!rows.length)return '<div class="panel muted">Malumot yoq</div>'; const keys=Object.keys(rows[0]); return '<table><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(r[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
  function lineChart(id,rows,color){setTimeout(()=>{const c=document.getElementById(id),x=c.getContext('2d'),w=c.width=c.clientWidth*2,h=c.height=c.clientHeight*2,m=36,max=Math.max(1,...rows.map(r=>Number(r.count))); x.clearRect(0,0,w,h); x.strokeStyle='#d8dde5'; x.lineWidth=1; for(let i=0;i<5;i++){let y=m+(h-2*m)*i/4; x.beginPath(); x.moveTo(m,y); x.lineTo(w-m,y); x.stroke()} x.strokeStyle=color; x.fillStyle=color+'22'; x.lineWidth=4; x.beginPath(); rows.forEach((r,i)=>{let px=m+(w-2*m)*i/Math.max(rows.length-1,1),py=h-m-(h-2*m)*Number(r.count)/max; i?x.lineTo(px,py):x.moveTo(px,py)}); x.stroke();},30)}
  async function load(){updated.textContent=new Date().toLocaleString(); if(current==='overview')return overviewView(); if(current==='participants')return participantsView(); if(current==='codes')return codesView(); if(current==='regions')return regionsView(); if(current==='payments')return paymentsView(); if(current==='export')return exportView(); if(current==='logs')return logsView()}
  async function overviewView(){const d=await api('/dashboard/api/overview?'+qs()); const s=d.summary; overview.innerHTML='<div class="kpis">'+[['Jami obunachilar',s.users,'Start bosganlar'],['Bugungi obunachilar',s.todayUsers,'Bugun royxatdan otgan'],['Jami promokodlar',s.totalCodes,'Import qilingan'],['Yutuqli kodlar',s.winnerCodes,'Pul tushadigan kodlar'],['Bugungi kodlar',s.todayRedemptions,'Bugun kiritilgan'],['Ishtirokchilar',s.uniqueParticipants,'Kod kiritgan userlar'],['Mavjud yutuqlar',s.availableWinnerCodes,'Hali ishlatilmagan'],['Failed/Pending',s.failedPayouts+' / '+s.pendingPayments,'Operator nazorati']].map((a,i)=>'<div class="card '+(i===7?'hot':'')+'"><div class="label">'+a[0]+'</div><div class="value">'+fmt(a[1])+'</div><div class="hint">'+a[2]+'</div></div>').join('')+'</div><div class="grid2" style="margin-top:22px"><div class="panel"><h3>Promokodlar dinamikasi</h3><canvas class="chart" id="redChart"></canvas></div><div class="panel"><h3>Yangi obunachilar</h3><canvas class="chart" id="userChart"></canvas></div></div><div class="grid2"><div class="panel"><h3>Hududlar boyicha</h3>'+regionBars(d.regionStats)+'</div><div class="panel"><h3>Kodlar soni boyicha ishtirokchilar</h3>'+table(d.codeBuckets)+'</div></div>'; lineChart('redChart',d.dailyRedemptions,'#c4002f'); lineChart('userChart',d.dailyUsers,'#3159c9')}
  function regionBars(rows){const max=Math.max(1,...rows.map(r=>Number(r.redemptions))); return '<table><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r.region)+'</b></td><td>'+fmt(r.users)+'</td><td class="money">'+fmt(r.redemptions)+'</td><td><div class="bar"><span style="width:'+Math.round(Number(r.redemptions)*100/max)+'%"></span></div></td></tr>').join('')+'</tbody></table>'}
  async function participantsView(){const d=await api('/dashboard/api/participants?'+qs()); participants.innerHTML='<div class="panel"><b>Jami: '+fmt(d.total)+'</b></div>'+table(d.rows)}
  async function codesView(){const d=await api('/dashboard/api/codes?'+qs()); codes.innerHTML='<div class="panel"><b>Jami: '+fmt(d.total)+'</b><div class="hint">Kodlar xavfsizlik uchun faqat oxirgi 4-8 belgisi bilan korsatiladi.</div></div>'+table(d.rows)}
  async function regionsView(){const rows=await api('/dashboard/api/regions'); regions.innerHTML='<div class="panel">'+table(rows)+'</div>'}
  async function paymentsView(){const d=await api('/dashboard/api/payments?'+qs()); payments.innerHTML='<div class="panel"><button class="btn danger" onclick="retry()">Failed payout retry</button> <b>Jami: '+fmt(d.total)+'</b></div>'+table(d.rows)}
  async function retry(){if(!confirm('Failed payoutlar qayta yuborilsinmi?'))return; alert(JSON.stringify(await api('/dashboard/api/paynet/retry-failed',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),null,2)); load()}
  function exportView(){export.innerHTML='<div class="grid2"><div class="panel"><h3>Eksport</h3><p>Operator tekshiruvi uchun CSV yuklab olish.</p></div><div class="panel"><a class="btn danger" href="/dashboard/export?type=participants">Ishtirokchilar CSV</a> <a class="btn danger" href="/dashboard/export?type=codes">Kodlar CSV</a> <a class="btn danger" href="/dashboard/export?type=payments">Paynet CSV</a></div></div>'}
  async function logsView(){const rows=await api('/dashboard/api/logs'); logs.innerHTML='<div class="panel"><pre>'+esc(JSON.stringify(rows,null,2))+'</pre></div>'}
  setInterval(()=>clock.textContent=new Date().toLocaleTimeString(),1000); setInterval(()=>load().catch(()=>{}),30000); load();
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

    if (req.method === "GET" && url.pathname === "/dashboard/api/codes") {
      sendJson(res, 200, await getCodes(dataSource, url));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/regions") {
      sendJson(res, 200, await getRegions(dataSource));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/payments") {
      sendJson(res, 200, await getPayments(dataSource, url));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/dashboard/api/logs") {
      sendJson(res, 200, getRecentLogs(120));
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
      sendCsv(res, `${type}.csv`, await exportRows(dataSource, type));
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
