import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { PromoCodeCatalog } from "./PromoCodeCatalog";
import { PaynetTransaction } from "./PaynetTransaction";
import { TelegramUser } from "./TelegramUser";

export type PromoCodeRedemptionStatus = "accepted" | "paid" | "payout_failed";

@Entity({ name: "promo_code_redemptions" })
export class PromoCodeRedemption {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "uuid" })
  promoCodeId!: string;

  @ManyToOne(() => PromoCodeCatalog, (promoCode) => promoCode.redemptions, { onDelete: "RESTRICT" })
  promoCode!: PromoCodeCatalog;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => TelegramUser, (user) => user.promoCodeRedemptions, { onDelete: "CASCADE" })
  user!: TelegramUser;

  @Column({ type: "integer" })
  rewardAmount!: number;

  @Column({ type: "varchar", length: 32, default: "accepted" })
  status!: PromoCodeRedemptionStatus;

  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @OneToOne(() => PaynetTransaction, (transaction) => transaction.promoCodeRedemption)
  paynetTransaction!: PaynetTransaction | null;

  @CreateDateColumn()
  createdAt!: Date;
}
