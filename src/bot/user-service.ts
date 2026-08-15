import { DataSource } from "typeorm";
import { User } from "grammy/types";
import { TelegramUser, UserStep } from "../entities/TelegramUser";
import { PromoCode } from "../entities/PromoCode";

export class UserService {
  constructor(private readonly dataSource: DataSource) {}

  async getOrCreate(from: User): Promise<TelegramUser> {
    const users = this.dataSource.getRepository(TelegramUser);
    let user = await users.findOneBy({ telegramId: String(from.id) });

    if (!user) {
      user = users.create({
        telegramId: String(from.id),
        username: "username" in from ? from.username ?? null : null,
        firstName: "first_name" in from ? from.first_name ?? null : null,
        lastName: "last_name" in from ? from.last_name ?? null : null,
      });
    } else {
      user.username = "username" in from ? from.username ?? null : user.username;
      user.firstName = "first_name" in from ? from.first_name ?? null : user.firstName;
      user.lastName = "last_name" in from ? from.last_name ?? null : user.lastName;
    }

    return users.save(user);
  }

  async setStep(user: TelegramUser, step: UserStep): Promise<TelegramUser> {
    user.step = step;
    return this.dataSource.getRepository(TelegramUser).save(user);
  }

  async setPaynetDraftPhone(user: TelegramUser, phone: string | null): Promise<TelegramUser> {
    user.paynetDraftPhone = phone;
    return this.dataSource.getRepository(TelegramUser).save(user);
  }

  async savePromoCode(user: TelegramUser, code: string): Promise<PromoCode> {
    const promoCodes = this.dataSource.getRepository(PromoCode);
    const promoCode = promoCodes.create({ user, code: code.trim().toUpperCase() });

    return promoCodes.save(promoCode);
  }

  async listPromoCodes(user: TelegramUser): Promise<PromoCode[]> {
    return this.dataSource.getRepository(PromoCode).find({
      where: { user: { id: user.id } },
      order: { createdAt: "DESC" },
    });
  }
}
