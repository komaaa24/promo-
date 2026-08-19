import { timingSafeEqual } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { logger } from "../logger";
import { PaynetService } from "../payments/paynet-service";

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
  if (!env.admin.username || !env.admin.password) {
    sendJson(res, 503, { ok: false, message: "Admin panel is disabled" });
    return false;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Promo Bot Admin"', "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Unauthorized" }));
    return false;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return false;
  }

  if (!safeEqual(decoded.slice(0, separatorIndex), env.admin.username)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return false;
  }

  if (!safeEqual(decoded.slice(separatorIndex + 1), env.admin.password)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return false;
  }

  return true;
}

function parseLimit(url: URL, fallback = 50): number {
  const parsed = Number(url.searchParams.get("limit") ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 500 ? parsed : fallback;
}

async function getStats(dataSource: DataSource): Promise<Record<string, unknown>> {
  const [summary] = (await dataSource.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "telegram_users") AS "users",
      (SELECT COUNT(*)::int FROM "promo_code_catalog") AS "promoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "isActive" = true) AS "activePromoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "rewardAmount" > 0) AS "winnerPromoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "redeemedAt" IS NOT NULL) AS "redeemedPromoCodes",
      (SELECT COUNT(*)::int FROM "promo_code_catalog" WHERE "rewardAmount" > 0 AND "redeemedAt" IS NULL) AS "availableWinnerPromoCodes",
      (SELECT COALESCE(SUM("rewardAmount"), 0)::int FROM "promo_code_redemptions") AS "acceptedRewardAmount",
      (SELECT COALESCE(SUM("amount"), 0)::int FROM "paynet_transactions" WHERE "status" <> 'failed') AS "requestedPaynetAmount",
      (SELECT COALESCE(SUM("amount"), 0)::int FROM "paynet_transactions" WHERE "status" = 'success') AS "successfulPaynetAmount",
      (SELECT COUNT(*)::int FROM "promo_code_redemptions" WHERE "status" = 'payout_failed') AS "failedPayouts"
  `)) as Array<Record<string, unknown>>;

  const paymentStatuses = await dataSource.query(`
    SELECT "status", COUNT(*)::int AS "count", COALESCE(SUM("amount"), 0)::int AS "amount"
    FROM "paynet_transactions"
    GROUP BY "status"
    ORDER BY "status"
  `);

  const redemptionStatuses = await dataSource.query(`
    SELECT "status", COUNT(*)::int AS "count", COALESCE(SUM("rewardAmount"), 0)::int AS "amount"
    FROM "promo_code_redemptions"
    GROUP BY "status"
    ORDER BY "status"
  `);

  return { summary, paymentStatuses, redemptionStatuses };
}

async function getRecentRedemptions(dataSource: DataSource, limit: number): Promise<Record<string, unknown>[]> {
  return dataSource.query(
    `
      SELECT
        r."id",
        r."createdAt",
        r."rewardAmount",
        r."status",
        r."errorMessage",
        c."codeSuffix",
        u."telegramId",
        u."fullName",
        u."phone",
        p."status" AS "paynetStatus",
        p."providerId",
        p."providerUuid"
      FROM "promo_code_redemptions" r
      JOIN "promo_code_catalog" c ON c."id" = r."promoCodeId"
      JOIN "telegram_users" u ON u."id" = r."userId"
      LEFT JOIN "paynet_transactions" p ON p."promoCodeRedemptionId" = r."id"
      ORDER BY r."createdAt" DESC
      LIMIT $1
    `,
    [limit],
  );
}

async function getRecentPayments(dataSource: DataSource, limit: number): Promise<Record<string, unknown>[]> {
  return dataSource.query(
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
        p."promoCodeRedemptionId",
        u."telegramId",
        u."fullName"
      FROM "paynet_transactions" p
      JOIN "telegram_users" u ON u."id" = p."userId"
      ORDER BY p."createdAt" DESC
      LIMIT $1
    `,
    [limit],
  );
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

  logger.info("Admin retried failed payouts", { requested: rows.length, results });
  return { requested: rows.length, results };
}

function adminHtml(): string {
  return `<!doctype html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Promo Bot Admin</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f6f7f9;color:#1f2937}
    header{background:#111827;color:white;padding:16px 24px}
    main{padding:20px;max-width:1200px;margin:auto}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
    .card{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:14px}
    .value{font-size:26px;font-weight:700;margin-top:8px}
    table{width:100%;border-collapse:collapse;background:white;border:1px solid #e5e7eb}
    th,td{font-size:13px;text-align:left;border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top}
    th{background:#f3f4f6}
    button{background:#2563eb;color:white;border:0;border-radius:6px;padding:10px 12px;cursor:pointer}
    button.danger{background:#b91c1c}
    section{margin-top:22px}
    pre{background:#111827;color:#e5e7eb;border-radius:8px;padding:12px;overflow:auto}
  </style>
</head>
<body>
  <header><h2>Promo Bot Admin</h2></header>
  <main>
    <div>
      <button onclick="loadAll()">Yangilash</button>
      <button class="danger" onclick="retryFailed()">Failed payout retry</button>
    </div>
    <section><div id="stats" class="grid"></div></section>
    <section><h3>Payment status</h3><table id="paymentStatuses"></table></section>
    <section><h3>Redemption status</h3><table id="redemptionStatuses"></table></section>
    <section><h3>Oxirgi promokod ishlatishlar</h3><table id="redemptions"></table></section>
    <section><h3>Oxirgi Paynet so'rovlar</h3><table id="payments"></table></section>
    <section><h3>Admin log</h3><pre id="log">Loading...</pre></section>
  </main>
  <script>
    async function api(path, options){ const r = await fetch(path, options); if(!r.ok) throw new Error(await r.text()); return r.json(); }
    function cell(v){ return v === null || v === undefined ? '' : String(v); }
    function table(id, rows){
      const el = document.getElementById(id);
      if(!rows.length){ el.innerHTML = '<tr><td>Ma\\'lumot yo\\'q</td></tr>'; return; }
      const keys = Object.keys(rows[0]);
      el.innerHTML = '<thead><tr>'+keys.map(k=>'<th>'+k+'</th>').join('')+'</tr></thead><tbody>'+
        rows.map(row=>'<tr>'+keys.map(k=>'<td>'+cell(row[k])+'</td>').join('')+'</tr>').join('')+'</tbody>';
    }
    async function loadAll(){
      const stats = await api('/admin/api/stats');
      const summary = stats.summary || {};
      document.getElementById('stats').innerHTML = Object.keys(summary).map(k => '<div class="card"><div>'+k+'</div><div class="value">'+cell(summary[k])+'</div></div>').join('');
      table('paymentStatuses', stats.paymentStatuses || []);
      table('redemptionStatuses', stats.redemptionStatuses || []);
      table('redemptions', await api('/admin/api/redemptions?limit=50'));
      table('payments', await api('/admin/api/payments?limit=50'));
      document.getElementById('log').textContent = 'Last updated: ' + new Date().toLocaleString();
    }
    async function retryFailed(){
      if(!confirm('Failed payoutlarni qayta yuborilsinmi?')) return;
      const result = await api('/admin/api/paynet/retry-failed', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
      document.getElementById('log').textContent = JSON.stringify(result, null, 2);
      await loadAll();
    }
    loadAll().catch(e => document.getElementById('log').textContent = e.message);
    setInterval(() => loadAll().catch(() => undefined), 30000);
  </script>
</body>
</html>`;
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dataSource: DataSource,
): Promise<boolean> {
  if (!req.url?.startsWith("/admin")) {
    return false;
  }

  if (!requireAdmin(req, res)) {
    return true;
  }

  const url = new URL(req.url, "http://localhost");

  try {
    if (req.method === "GET" && url.pathname === "/admin") {
      sendHtml(res, adminHtml());
      return true;
    }

    if (req.method === "GET" && url.pathname === "/admin/api/stats") {
      sendJson(res, 200, await getStats(dataSource));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/admin/api/redemptions") {
      sendJson(res, 200, await getRecentRedemptions(dataSource, parseLimit(url)));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/admin/api/payments") {
      sendJson(res, 200, await getRecentPayments(dataSource, parseLimit(url)));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/admin/api/paynet/retry-failed") {
      const body = await readJson(req);
      const redemptionId = typeof body.redemptionId === "string" ? body.redemptionId : undefined;
      const limit = typeof body.limit === "number" ? body.limit : 20;
      sendJson(res, 200, await retryFailed(dataSource, redemptionId, limit));
      return true;
    }

    sendJson(res, 404, { ok: false, message: "Not found" });
    return true;
  } catch (error) {
    logger.error("Admin request failed", {
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 500, { ok: false, message: "Admin request failed" });
    return true;
  }
}
