import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Bot } from "grammy";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { logger } from "../logger";
import { BotContext } from "../bot/types";
import { PaynetService } from "./paynet-service";

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

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

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function startCallbackServer(dataSource: DataSource, bot: Bot<BotContext>): Server {
  const paynetService = new PaynetService(dataSource);

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== "POST" || req.url !== "/callbacks/digital-pay") {
      sendJson(res, 404, { ok: false, message: "Not found" });
      return;
    }

    try {
      const payload = await readJson(req);
      const transaction = await paynetService.applyCallback(payload);

      if (!transaction) {
        sendJson(res, 202, { ok: true, matched: false });
        return;
      }

      if (transaction.user?.telegramId) {
        await bot.api
          .sendMessage(
            transaction.user.telegramId,
            [
              "Paynet status yangilandi",
              "",
              `Telefon: ${transaction.phone}`,
              `Summa: ${transaction.amount} so'm`,
              `Status: ${transaction.status}`,
            ].join("\n"),
          )
          .catch((error) => {
            logger.warn("Failed to notify user about Paynet callback", {
              transactionId: transaction.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      sendJson(res, 200, { ok: true, matched: true });
    } catch (error) {
      logger.error("Digital Pay callback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      sendJson(res, 400, { ok: false, message: "Invalid callback" });
    }
  });

  server.listen(env.httpPort, () => {
    logger.info("Callback server started", {
      port: env.httpPort,
      callbackPath: "/callbacks/digital-pay",
      publicCallbackUrl: env.publicBaseUrl ? `${env.publicBaseUrl}/callbacks/digital-pay` : undefined,
    });
  });

  return server;
}
