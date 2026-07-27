import { Bot } from "grammy";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { BotContext } from "./types";
import { UserService } from "./user-service";
import { registerHandlers } from "./handlers";

export function createBot(dataSource: DataSource): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.botToken);
  const userService = new UserService(dataSource);

  bot.use(async (ctx, next) => {
    if (!ctx.from) {
      return;
    }

    ctx.dbUser = await userService.getOrCreate(ctx.from);
    await next();
  });

  registerHandlers(bot, userService);

  bot.catch((error) => {
    console.error("Bot error", error);
  });

  return bot;
}
