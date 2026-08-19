import { DataSource } from "typeorm";
import { PromoCodeRedemption } from "../entities/PromoCodeRedemption";
import { TelegramUser } from "../entities/TelegramUser";
import {
  PaynetTransaction,
  PaynetTransactionStatus,
} from "../entities/PaynetTransaction";
import { DigitalPayClient, DigitalPayError, DigitalPayTransaction } from "./digital-pay-client";

type CallbackPayload = Record<string, unknown>;

function normalizeProviderStatus(status: unknown): PaynetTransactionStatus {
  if (typeof status !== "string") {
    return "unknown";
  }

  const normalized = status.toLowerCase();

  if (["success", "successful", "completed", "paid", "done"].includes(normalized)) {
    return "success";
  }

  if (["failed", "error", "rejected"].includes(normalized)) {
    return "failed";
  }

  if (["cancelled", "canceled"].includes(normalized)) {
    return "cancelled";
  }

  if (normalized === "pending") {
    return "pending";
  }

  return "unknown";
}

function getNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class PaynetService {
  private readonly client = new DigitalPayClient();

  constructor(private readonly dataSource: DataSource) {}

  async create(
    user: TelegramUser,
    phone: string,
    amount: number,
    options: { promoCodeRedemptionId?: string } = {},
  ): Promise<PaynetTransaction> {
    const transactions = this.dataSource.getRepository(PaynetTransaction);
    const transaction = transactions.create({
      user,
      userId: user.id,
      phone,
      amount,
      status: "local_pending",
      promoCodeRedemptionId: options.promoCodeRedemptionId ?? null,
    });

    await transactions.save(transaction);

    try {
      const providerTransaction = await this.client.createTransaction(phone, amount);
      this.applyProviderTransaction(transaction, providerTransaction);
      transaction.status = normalizeProviderStatus(providerTransaction.status ?? "pending");
      transaction.providerPayload = providerTransaction;

      return transactions.save(transaction);
    } catch (error) {
      transaction.status = "failed";
      transaction.errorMessage =
        error instanceof DigitalPayError || error instanceof Error ? error.message : "Payment request failed";

      return transactions.save(transaction);
    }
  }

  async applyCallback(payload: CallbackPayload): Promise<PaynetTransaction | null> {
    const transactions = this.dataSource.getRepository(PaynetTransaction);
    const uuid = getString(payload.uuid ?? payload.transaction_uuid ?? payload.providerUuid);
    const providerId = getNumber(payload.id ?? payload.transaction_id ?? payload.providerId);

    const transaction = uuid
      ? await transactions.findOne({ where: { providerUuid: uuid }, relations: { user: true } })
      : providerId
        ? await transactions.findOne({ where: { providerId }, relations: { user: true } })
        : null;

    if (!transaction) {
      return null;
    }

    transaction.callbackPayload = payload;
    transaction.status = normalizeProviderStatus(payload.status);

    return transactions.save(transaction);
  }

  async listForUser(user: TelegramUser, take = 5): Promise<PaynetTransaction[]> {
    return this.dataSource.getRepository(PaynetTransaction).find({
      where: { userId: user.id },
      order: { createdAt: "DESC" },
      take,
    });
  }

  async retryPromoPayout(redemptionId: string): Promise<PaynetTransaction> {
    const redemptions = this.dataSource.getRepository(PromoCodeRedemption);
    const transactions = this.dataSource.getRepository(PaynetTransaction);
    const redemption = await redemptions.findOne({
      where: { id: redemptionId },
      relations: { user: true, paynetTransaction: true },
    });

    if (!redemption) {
      throw new Error("Promo redemption not found");
    }

    if (redemption.rewardAmount <= 0) {
      throw new Error("Promo redemption has no reward amount");
    }

    if (!redemption.user.phone) {
      throw new Error("Promo redemption user has no phone");
    }

    if (redemption.status === "paid" && redemption.paynetTransaction?.status !== "failed") {
      throw new Error("Promo redemption is already paid or pending");
    }

    const transaction =
      redemption.paynetTransaction ??
      transactions.create({
        user: redemption.user,
        userId: redemption.userId,
        phone: redemption.user.phone.replace(/^\+998/, ""),
        amount: redemption.rewardAmount,
        status: "local_pending",
        promoCodeRedemptionId: redemption.id,
      });

    transaction.phone = redemption.user.phone.replace(/^\+998/, "");
    transaction.amount = redemption.rewardAmount;
    transaction.status = "local_pending";
    transaction.errorMessage = null;
    await transactions.save(transaction);

    try {
      const providerTransaction = await this.client.createTransaction(transaction.phone, transaction.amount);
      this.applyProviderTransaction(transaction, providerTransaction);
      transaction.status = normalizeProviderStatus(providerTransaction.status ?? "pending");
      transaction.providerPayload = providerTransaction;
      transaction.errorMessage = null;
      const savedTransaction = await transactions.save(transaction);

      redemption.status = savedTransaction.status === "failed" ? "payout_failed" : "paid";
      redemption.errorMessage = null;
      await redemptions.save(redemption);

      return savedTransaction;
    } catch (error) {
      transaction.status = "failed";
      transaction.errorMessage =
        error instanceof DigitalPayError || error instanceof Error ? error.message : "Payment request failed";
      const savedTransaction = await transactions.save(transaction);

      redemption.status = "payout_failed";
      redemption.errorMessage = savedTransaction.errorMessage;
      await redemptions.save(redemption);

      return savedTransaction;
    }
  }

  private applyProviderTransaction(transaction: PaynetTransaction, providerTransaction: DigitalPayTransaction): void {
    transaction.providerUuid = getString(providerTransaction.uuid);
    transaction.providerId = getNumber(providerTransaction.id);
  }
}
