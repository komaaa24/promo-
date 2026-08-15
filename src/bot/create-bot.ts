import { Bot } from "grammy";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { BotContext } from "./types";
import { UserService } from "./user-service";
import { registerHandlers } from "./handlers";
import { logger } from "../logger";
import { PaynetService } from "../payments/paynet-service";
import { PromoCodeService } from "../promo/promo-code-service";

export function createBot(dataSource: DataSource): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.botToken);
  const userService = new UserService(dataSource);
  const paynetService = new PaynetService(dataSource);
  const promoCodeService = new PromoCodeService(dataSource);

  bot.use(async (ctx, next) => {
    if (!ctx.from) {
      return;
    }

    ctx.dbUser = await userService.getOrCreate(ctx.from);
    await next();
  });

  registerHandlers(bot, userService, paynetService, promoCodeService);

  bot.catch(async (error) => {
    const ctx = error.ctx;

    logger.error("Bot update failed", {
      updateId: ctx.update.update_id,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
      error: error.error instanceof Error ? error.error.message : String(error.error),
    });

    await ctx.reply("Texnik xatolik yuz berdi. Iltimos, qayta urinib ko'ring.").catch(() => undefined);
  });

  return bot;
}
