import "reflect-metadata";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { PromoCode } from "../entities/PromoCode";
import { TelegramUser } from "../entities/TelegramUser";
import { InitialSchema1720000000000 } from "./migrations/1720000000000-InitialSchema";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: env.database.host,
  port: env.database.port,
  username: env.database.username,
  password: env.database.password,
  database: env.database.database,
  synchronize: false,
  logging: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  entities: [TelegramUser, PromoCode],
  migrations: [InitialSchema1720000000000],
});
