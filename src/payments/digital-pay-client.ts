import { env } from "../config/env";

export class DigitalPayError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly payload?: unknown,
  ) {
    super(message);
  }
}

export type DigitalPayTransaction = {
  id?: number;
  uuid?: string;
  amount?: number;
  phone?: string;
  status?: string;
  time?: number;
  [key: string]: unknown;
};

type DigitalPayResponse<T> = {
  message?: string;
  data?: T;
  [key: string]: unknown;
};

function assertConfigured(): { token: string; username: string; password: string } {
  const { token, username, password } = env.digitalPay;

  if (!token || !username || !password) {
    throw new DigitalPayError("Digital Pay credentials are not configured");
  }

  return { token, username, password };
}

export class DigitalPayClient {
  private readonly baseUrl = env.digitalPay.baseUrl.replace(/\/+$/, "");

  async createTransaction(phone: string, amount: number): Promise<DigitalPayTransaction> {
    const response = await this.request<DigitalPayTransaction>("/api/transactions/store", { phone, amount });

    if (!response.data || typeof response.data !== "object") {
      throw new DigitalPayError("Digital Pay returned an empty transaction response", undefined, response);
    }

    return response.data;
  }

  async getTransactions(): Promise<DigitalPayTransaction[]> {
    const response = await this.request<DigitalPayTransaction[]>("/api/transactions/get", {});
    return Array.isArray(response.data) ? response.data : [];
  }

  async getBalance(): Promise<string> {
    const response = await this.request<string | number>("/api/user/balance", {});
    return response.data === undefined ? "0" : String(response.data);
  }

  private async request<T>(path: string, payload: Record<string, unknown>): Promise<DigitalPayResponse<T>> {
    const { token, username, password } = assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.digitalPay.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        },
        body: JSON.stringify({ token, ...payload }),
        signal: controller.signal,
      });

      const text = await response.text();
      const data = text ? (JSON.parse(text) as DigitalPayResponse<T>) : {};

      if (!response.ok) {
        throw new DigitalPayError(`Digital Pay request failed with ${response.status}`, response.status, data);
      }

      return data;
    } catch (error) {
      if (error instanceof DigitalPayError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new DigitalPayError("Digital Pay request timed out");
      }

      throw new DigitalPayError(error instanceof Error ? error.message : "Digital Pay request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}
