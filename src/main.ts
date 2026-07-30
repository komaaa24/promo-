import { AppDataSource } from "./database/data-source";
import { createBot } from "./bot/create-bot";
import { logger } from "./logger";

async function bootstrap(): Promise<void> {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();

  const bot = createBot(AppDataSource);

  await bot.api.setMyCommands([
    { command: "start", description: "Botni boshlash" },
  ]);

  await bot.start({
    onStart: (botInfo) => {
      logger.info("Bot started", { username: botInfo.username });
    },
  });

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info("Stopping bot", { signal });
    bot.stop();
    await AppDataSource.destroy();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

bootstrap().catch((error) => {
  logger.error("Bootstrap failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
