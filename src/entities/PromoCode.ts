import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { TelegramUser } from "./TelegramUser";

@Entity({ name: "promo_codes" })
export class PromoCode {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 80 })
  code!: string;

  @ManyToOne(() => TelegramUser, (user) => user.promoCodes, {
    nullable: false,
    onDelete: "CASCADE",
  })
  user!: TelegramUser;

  @CreateDateColumn()
  createdAt!: Date;
}
