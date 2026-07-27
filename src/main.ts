import { AppDataSource } from "./database/data-source";
import { createBot } from "./bot/create-bot";

async function bootstrap(): Promise<void> {
  await AppDataSource.initialize();

  const bot = createBot(AppDataSource);

  await bot.api.setMyCommands([
    { command: "start", description: "Botni boshlash" },
  ]);

  await bot.start({
    onStart: (botInfo) => {
      console.log(`Bot started: @${botInfo.username}`);
    },
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
