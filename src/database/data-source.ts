import "reflect-metadata";
import { DataSource } from "typeorm";
import { env } from "../config/env";
import { PromoCode } from "../entities/PromoCode";
import { PaynetTransaction } from "../entities/PaynetTransaction";
import { PromoCodeCatalog } from "../entities/PromoCodeCatalog";
import { PromoCodeRedemption } from "../entities/PromoCodeRedemption";
import { TelegramUser } from "../entities/TelegramUser";
import { InitialSchema1720000000000 } from "./migrations/1720000000000-InitialSchema";
import { AddPaynetTransactions1720000001000 } from "./migrations/1720000001000-AddPaynetTransactions";
import { AddPromoCodeCatalog1720000002000 } from "./migrations/1720000002000-AddPromoCodeCatalog";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: env.database.host,
  port: env.database.port,
  username: env.database.username,
  password: env.database.password,
  database: env.database.database,
  synchronize: false,
  logging: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  entities: [TelegramUser, PromoCode, PaynetTransaction, PromoCodeCatalog, PromoCodeRedemption],
  migrations: [InitialSchema1720000000000, AddPaynetTransactions1720000001000, AddPromoCodeCatalog1720000002000],
});
