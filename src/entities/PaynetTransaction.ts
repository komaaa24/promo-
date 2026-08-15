import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
  OneToOne,
} from "typeorm";
import { TelegramUser } from "./TelegramUser";
import { PromoCodeRedemption } from "./PromoCodeRedemption";

export type PaynetTransactionStatus = "local_pending" | "pending" | "success" | "failed" | "cancelled" | "unknown";

@Entity({ name: "paynet_transactions" })
export class PaynetTransaction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 36, nullable: true })
  providerUuid!: string | null;

  @Index()
  @Column({ type: "integer", nullable: true })
  providerId!: number | null;

  @Column({ type: "varchar", length: 32 })
  phone!: string;

  @Column({ type: "integer" })
  amount!: number;

  @Column({ type: "varchar", length: 32, default: "local_pending" })
  status!: PaynetTransactionStatus;

  @Column({ type: "jsonb", nullable: true })
  providerPayload!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  callbackPayload!: Record<string, unknown> | null;

  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @Column({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => TelegramUser, (user) => user.paynetTransactions, { onDelete: "CASCADE" })
  user!: TelegramUser;

  @Column({ type: "uuid", nullable: true })
  promoCodeRedemptionId!: string | null;

  @OneToOne(() => PromoCodeRedemption, (redemption) => redemption.paynetTransaction, { nullable: true })
  @JoinColumn({ name: "promoCodeRedemptionId" })
  promoCodeRedemption!: PromoCodeRedemption | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
