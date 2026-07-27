import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { PromoCode } from "./PromoCode";

export type LanguageCode = "uz" | "ru";

export type UserStep =
  | "ASK_FULL_NAME"
  | "ASK_PHONE"
  | "ASK_REGION"
  | "ASK_DISTRICT"
  | "MENU"
  | "ASK_PROMO_CODE";

@Entity({ name: "telegram_users" })
export class TelegramUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "bigint" })
  telegramId!: string;

  @Column({ type: "varchar", length: 16, default: "uz" })
  language!: LanguageCode;

  @Column({ type: "varchar", length: 160, nullable: true })
  fullName!: string | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  address!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  selectedRegion!: string | null;

  @Column({ type: "varchar", length: 32, default: "ASK_FULL_NAME" })
  step!: UserStep;

  @Column({ type: "varchar", length: 64, nullable: true })
  username!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  firstName!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  lastName!: string | null;

  @OneToMany(() => PromoCode, (promoCode) => promoCode.user)
  promoCodes!: PromoCode[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
