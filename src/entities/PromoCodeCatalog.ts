import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { PromoCodeRedemption } from "./PromoCodeRedemption";

@Entity({ name: "promo_code_catalog" })
export class PromoCodeCatalog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "char", length: 64 })
  codeHash!: string;

  @Column({ type: "varchar", length: 8 })
  codeSuffix!: string;

  @Column({ type: "text", nullable: true })
  codeEncrypted!: string | null;

  @Column({ type: "integer", default: 0 })
  rewardAmount!: number;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "uuid", nullable: true })
  redeemedByUserId!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  redeemedAt!: Date | null;

  @OneToMany(() => PromoCodeRedemption, (redemption) => redemption.promoCode)
  redemptions!: PromoCodeRedemption[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
