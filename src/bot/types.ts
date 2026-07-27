import { Context } from "grammy";
import { TelegramUser } from "../entities/TelegramUser";

export type BotContext = Context & {
  dbUser: TelegramUser;
};
