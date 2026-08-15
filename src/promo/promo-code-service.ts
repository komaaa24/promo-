import { DataSource } from "typeorm";
import { env } from "../config/env";
import { PromoCodeCatalog } from "../entities/PromoCodeCatalog";
import { PromoCodeRedemption } from "../entities/PromoCodeRedemption";
import { TelegramUser } from "../entities/TelegramUser";
import { PaynetService } from "../payments/paynet-service";
import { hashPromoCode, normalizePromoCode } from "./promo-code-utils";

export type RedeemPromoCodeResult =
  | { status: "invalid_format" }
  | { status: "not_found" }
  | { status: "inactive" }
  | { status: "already_used"; redeemedAt: Date | null }
  | { status: "payout_not_configured" }
  | { status: "phone_missing" }
  | { status: "accepted"; redemption: PromoCodeRedemption; payoutStatus: "not_required" | "pending" | "failed" };

type RedeemPromoCodeRejectedResult = Exclude<RedeemPromoCodeResult, { status: "accepted" }>;

export class PromoCodeService {
  private readonly paynetService: PaynetService;

  constructor(private readonly dataSource: DataSource) {
    this.paynetService = new PaynetService(dataSource);
  }

  async redeem(user: TelegramUser, rawCode: string): Promise<RedeemPromoCodeResult> {
    const normalizedCode = normalizePromoCode(rawCode);

    if (!normalizedCode) {
      return { status: "invalid_format" };
    }

    const codeHash = hashPromoCode(normalizedCode);

    const redemption = await this.dataSource.transaction<
      { result: RedeemPromoCodeRejectedResult } | { redemption: PromoCodeRedemption }
    >(async (manager) => {
      const promoCodes = manager.getRepository(PromoCodeCatalog);
      const redemptions = manager.getRepository(PromoCodeRedemption);
      const promoCode = await promoCodes.findOne({
        where: { codeHash },
        lock: { mode: "pessimistic_write" },
      });

      if (!promoCode) {
        return { result: { status: "not_found" } satisfies RedeemPromoCodeRejectedResult };
      }

      if (!promoCode.isActive) {
        return { result: { status: "inactive" } satisfies RedeemPromoCodeRejectedResult };
      }

      if (promoCode.redeemedAt || promoCode.redeemedByUserId) {
        return {
          result: { status: "already_used", redeemedAt: promoCode.redeemedAt } satisfies RedeemPromoCodeRejectedResult,
        };
      }

      if (promoCode.rewardAmount > 0 && !user.phone) {
        return { result: { status: "phone_missing" } satisfies RedeemPromoCodeRejectedResult };
      }

      if (
        promoCode.rewardAmount > 0 &&
        (!env.digitalPay.token || !env.digitalPay.username || !env.digitalPay.password)
      ) {
        return { result: { status: "payout_not_configured" } satisfies RedeemPromoCodeRejectedResult };
      }

      promoCode.redeemedByUserId = user.id;
      promoCode.redeemedAt = new Date();
      await promoCodes.save(promoCode);

      const createdRedemption = await redemptions.save(
        redemptions.create({
          promoCode,
          promoCodeId: promoCode.id,
          user,
          userId: user.id,
          rewardAmount: promoCode.rewardAmount,
          status: "accepted",
        }),
      );

      return { redemption: createdRedemption };
    });

    if ("result" in redemption) {
      return redemption.result;
    }

    if (redemption.redemption.rewardAmount <= 0) {
      return { status: "accepted", redemption: redemption.redemption, payoutStatus: "not_required" };
    }

    const userPhone = user.phone;

    if (!userPhone) {
      return { status: "accepted", redemption: redemption.redemption, payoutStatus: "failed" };
    }

    const payoutPhone = userPhone.replace(/^\+998/, "");
    const payout = await this.paynetService.create(user, payoutPhone, redemption.redemption.rewardAmount, {
      promoCodeRedemptionId: redemption.redemption.id,
    });

    redemption.redemption.status = payout.status === "failed" ? "payout_failed" : "paid";
    redemption.redemption.errorMessage = payout.errorMessage;
    await this.dataSource.getRepository(PromoCodeRedemption).save(redemption.redemption);

    return {
      status: "accepted",
      redemption: redemption.redemption,
      payoutStatus: payout.status === "failed" ? "failed" : "pending",
    };
  }

  async listForUser(user: TelegramUser, take = 5): Promise<PromoCodeRedemption[]> {
    return this.dataSource.getRepository(PromoCodeRedemption).find({
      where: { userId: user.id },
      order: { createdAt: "DESC" },
      take,
    });
  }
}
