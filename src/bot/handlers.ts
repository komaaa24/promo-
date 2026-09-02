import { Bot } from "grammy";
import { BotContext } from "./types";
import {
  buttons,
  cabinetKeyboard,
  districtInlineKeyboard,
  languageKeyboard,
  mainMenuKeyboard,
  mediaInlineKeyboard,
  phoneKeyboard,
  regionInlineKeyboard,
} from "./keyboards";
import { t } from "./i18n";
import { LanguageCode, TelegramUser, UserStep } from "../entities/TelegramUser";
import { UserService } from "./user-service";
import { getDistrictByIndex, getRegion, getRegionByIndex, isDistrict, Region } from "./locations";
import { env } from "../config/env";
import { PromoCodeService } from "../promo/promo-code-service";
import { PromoCodeRedemption } from "../entities/PromoCodeRedemption";

function normalizePhone(value: string): string | null {
  const cleaned = value.replace(/[\s()-]/g, "");

  if (/^\+998\d{9}$/.test(cleaned)) {
    return cleaned;
  }

  if (/^998\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  if (/^\d{9}$/.test(cleaned)) {
    return `+998${cleaned}`;
  }

  return null;
}

function isPromoConfigured(): boolean {
  return Boolean(env.promo.codeSecret && env.promo.codeSecret.length >= 32);
}

function formatPromoRedemption(redemption: PromoCodeRedemption, index: number): string {
  const code = redemption.promoCode?.codeEncrypted ?? redemption.promoCode?.codeSuffix ?? redemption.promoCodeId.slice(0, 8);
  const createdAt = redemption.createdAt.toLocaleString("ru-RU");
  const payout = redemption.paynetTransaction?.status ? `\nPaynet: ${redemption.paynetTransaction.status}` : "";

  return [
    `${index + 1}. Promokod: ${code}`,
    `Sana: ${createdAt}`,
    `Yutuq: ${redemption.rewardAmount} so'm`,
    `Status: ${redemption.status}`,
    `ID: ${redemption.id.slice(0, 8)}${payout}`,
  ].join("\n");
}

function isProfileComplete(user: TelegramUser): boolean {
  return Boolean(user.fullName?.trim() && user.phone?.trim() && user.address?.trim());
}

function nextRegistrationStep(user: TelegramUser): UserStep {
  if (!user.fullName?.trim()) {
    return "ASK_FULL_NAME";
  }

  if (!user.phone?.trim()) {
    return "ASK_PHONE";
  }

  if (!user.address?.trim()) {
    return "ASK_REGION";
  }

  return "MENU";
}

function chunkMessages(lines: string[], maxLength = 3500): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function isMenuButton(language: LanguageCode, text: string): boolean {
  return Object.values(buttons[language]).includes(text);
}

async function askRegion(ctx: BotContext): Promise<void> {
  if (env.addressStickerId) {
    await ctx.replyWithSticker(env.addressStickerId);
  }

  await ctx.reply(t(ctx.dbUser.language, "askRegion"), {
    reply_markup: regionInlineKeyboard(),
  });
}

async function askDistrict(ctx: BotContext, region: Region): Promise<void> {
  await ctx.reply(t(ctx.dbUser.language, "askDistrict"), {
    reply_markup: districtInlineKeyboard(ctx.dbUser.language, region),
  });
}

async function sendRegistrationSuccess(ctx: BotContext): Promise<void> {
  if (env.successStickerId) {
    await ctx.replyWithSticker(env.successStickerId);
  } else {
    await ctx.reply("✅");
  }

  await ctx.reply(
    `${t(ctx.dbUser.language, "congratulations")}\n${t(ctx.dbUser.language, "registrationSuccess")}\n\n${t(
      ctx.dbUser.language,
      "mainMenu",
    )}`,
    {
      reply_markup: mainMenuKeyboard(ctx.dbUser.language),
    },
  );
}

async function repeatCurrentStep(ctx: BotContext, userService: UserService): Promise<void> {
  const user = ctx.dbUser;

  if (user.step === "ASK_FULL_NAME") {
    await ctx.reply(t(user.language, "askFullName"), {
      reply_markup: languageKeyboard(user.language),
    });
    return;
  }

  if (user.step === "ASK_PHONE") {
    await ctx.reply(t(user.language, "askPhone"), {
      reply_markup: phoneKeyboard(user.language),
    });
    return;
  }

  if (user.step === "ASK_REGION") {
    await askRegion(ctx);
    return;
  }

  if (user.step === "ASK_DISTRICT") {
    const region = user.selectedRegion ? getRegion(user.selectedRegion) : null;

    if (region) {
      await askDistrict(ctx, region);
      return;
    }

    await askRegion(ctx);
    return;
  }

  if (user.step === "ASK_PROMO_CODE") {
    await ctx.reply(t(user.language, "promoCodeAsk"), {
      reply_markup: languageKeyboard(user.language),
    });
    return;
  }

  if (user.step === "ASK_PAYNET_PHONE" || user.step === "ASK_PAYNET_AMOUNT") {
    await userService.setPaynetDraftPhone(user, null);
    await userService.setStep(user, "MENU");
    await ctx.reply(t(user.language, "mainMenu"), {
      reply_markup: mainMenuKeyboard(user.language),
    });
    return;
  }

  await ctx.reply(t(user.language, "mainMenu"), {
    reply_markup: mainMenuKeyboard(user.language),
  });
}

export function registerHandlers(
  bot: Bot<BotContext>,
  userService: UserService,
  promoCodeService: PromoCodeService,
): void {
  bot.command("start", async (ctx) => {
    if (isProfileComplete(ctx.dbUser)) {
      await userService.setStep(ctx.dbUser, "MENU");
      await ctx.reply(`${t(ctx.dbUser.language, "alreadyRegistered")}\n\n${t(ctx.dbUser.language, "mainMenu")}`, {
        reply_markup: mainMenuKeyboard(ctx.dbUser.language),
      });
      return;
    }

    const step = nextRegistrationStep(ctx.dbUser);
    await userService.setStep(ctx.dbUser, step);
    await ctx.reply(t(ctx.dbUser.language, "start"));
    await repeatCurrentStep(ctx, userService);
  });

  bot.hears([buttons.uz.promoSend, buttons.ru.promoSend], async (ctx) => {
    if (!isProfileComplete(ctx.dbUser)) {
      await repeatCurrentStep(ctx, userService);
      return;
    }

    if (!isPromoConfigured()) {
      await ctx.reply(t(ctx.dbUser.language, "promoNotConfigured"), {
        reply_markup: mainMenuKeyboard(ctx.dbUser.language),
      });
      return;
    }

    await userService.setStep(ctx.dbUser, "ASK_PROMO_CODE");
    await ctx.reply(t(ctx.dbUser.language, "promoCodeAsk"), {
      reply_markup: languageKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.promoMine, buttons.ru.promoMine], async (ctx) => {
    if (!isProfileComplete(ctx.dbUser)) {
      await repeatCurrentStep(ctx, userService);
      return;
    }

    const codes = await promoCodeService.listForUser(ctx.dbUser);

    if (codes.length === 0) {
      await ctx.reply(t(ctx.dbUser.language, "promoCodesEmpty"), {
        reply_markup: mainMenuKeyboard(ctx.dbUser.language),
      });
      return;
    }

    const messages = chunkMessages(codes.map(formatPromoRedemption));

    for (const [index, message] of messages.entries()) {
      await ctx.reply(message, {
        reply_markup: index === messages.length - 1 ? mainMenuKeyboard(ctx.dbUser.language) : undefined,
      });
    }
  });

  bot.hears([buttons.uz.cabinet, buttons.ru.cabinet], async (ctx) => {
    if (!isProfileComplete(ctx.dbUser)) {
      await repeatCurrentStep(ctx, userService);
      return;
    }

    const user = ctx.dbUser;
    const profile = [
      `👤 ${t(user.language, "cabinet")}`,
      "",
      `ID: ${user.telegramId}`,
      `Ism: ${user.fullName ?? "-"}`,
      `Telefon: ${user.phone ?? "-"}`,
      `Manzil: ${user.address ?? "-"}`,
    ].join("\n");

    await ctx.reply(profile, { reply_markup: cabinetKeyboard(user.language) });
  });

  bot.hears([buttons.uz.language, buttons.ru.language], async (ctx) => {
    await ctx.reply(t(ctx.dbUser.language, "languageMenu"), {
      reply_markup: cabinetKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.terms, buttons.ru.terms], async (ctx) => {
    await ctx.reply(t(ctx.dbUser.language, "terms"), {
      reply_markup: mainMenuKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.media, buttons.ru.media], async (ctx) => {
    await ctx.reply(t(ctx.dbUser.language, "media"), {
      reply_markup: mediaInlineKeyboard(ctx.dbUser.language),
    });
    await ctx.reply(t(ctx.dbUser.language, "mainMenu"), {
      reply_markup: mainMenuKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.languageUz, buttons.ru.languageUz], async (ctx) => {
    ctx.dbUser.language = "uz";
    await userService.setStep(ctx.dbUser, ctx.dbUser.step);
    await ctx.reply(t("uz", "languageChanged"), {
      reply_markup: languageKeyboard("uz"),
    });
    await repeatCurrentStep(ctx, userService);
  });

  bot.hears([buttons.uz.languageRu, buttons.ru.languageRu], async (ctx) => {
    ctx.dbUser.language = "ru";
    await userService.setStep(ctx.dbUser, ctx.dbUser.step);
    await ctx.reply(t("ru", "languageChanged"), {
      reply_markup: languageKeyboard("ru"),
    });
    await repeatCurrentStep(ctx, userService);
  });

  bot.hears([buttons.uz.changeRegion, buttons.ru.changeRegion], async (ctx) => {
    ctx.dbUser.selectedRegion = null;
    await userService.setStep(ctx.dbUser, "ASK_REGION");
    await askRegion(ctx);
  });

  bot.hears([buttons.uz.back, buttons.ru.back], async (ctx) => {
    await userService.setStep(ctx.dbUser, "MENU");
    await ctx.reply(t(ctx.dbUser.language, "mainMenu"), {
      reply_markup: mainMenuKeyboard(ctx.dbUser.language),
    });
  });

  bot.callbackQuery("location:regions", async (ctx) => {
    ctx.dbUser.selectedRegion = null;
    await userService.setStep(ctx.dbUser, "ASK_REGION");
    await ctx.answerCallbackQuery();
    await askRegion(ctx);
  });

  bot.callbackQuery(/^region:(\d+)$/, async (ctx) => {
    const region = getRegionByIndex(Number(ctx.match[1]));

    if (!region || ctx.dbUser.step !== "ASK_REGION") {
      await ctx.answerCallbackQuery();
      await askRegion(ctx);
      return;
    }

    ctx.dbUser.address = region;
    ctx.dbUser.selectedRegion = null;
    await userService.setStep(ctx.dbUser, "MENU");
    await ctx.answerCallbackQuery(`${region} ${t(ctx.dbUser.language, "regionSelected")}`);
    await ctx.deleteMessage().catch(async () => {
      await ctx.editMessageReplyMarkup().catch(() => undefined);
    });
    await sendRegistrationSuccess(ctx);
  });

  bot.callbackQuery(/^district:(\d+):(\d+)$/, async (ctx) => {
    const region = getRegionByIndex(Number(ctx.match[1]));
    const district = region ? getDistrictByIndex(region, Number(ctx.match[2])) : null;

    if (!region || !district || ctx.dbUser.step !== "ASK_DISTRICT") {
      await ctx.answerCallbackQuery();
      await askRegion(ctx);
      return;
    }

    ctx.dbUser.selectedRegion = region;
    ctx.dbUser.address = `${region}, ${district}`;
    ctx.dbUser.selectedRegion = null;
    await userService.setStep(ctx.dbUser, "MENU");
    await ctx.answerCallbackQuery(t(ctx.dbUser.language, "districtSelected"));
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply(
      `${district} ${t(ctx.dbUser.language, "districtSelected")}\n\n${t(ctx.dbUser.language, "mainMenu")}`,
      { reply_markup: mainMenuKeyboard(ctx.dbUser.language) },
    );
  });

  bot.on("message", async (ctx) => {
    const user = ctx.dbUser;
    const text = ctx.message.text?.trim();

    if (ctx.message.contact && user.step === "ASK_PHONE") {
      user.phone = normalizePhone(ctx.message.contact.phone_number);
      user.step = "ASK_REGION";
      await userService.setStep(user, "ASK_REGION");
      await askRegion(ctx);
      return;
    }

    if (!text) {
      await ctx.reply(t(user.language, "unknown"));
      return;
    }

    if (isMenuButton(user.language, text)) {
      return;
    }

    if (user.step === "ASK_FULL_NAME") {
      if (text.split(/\s+/).length < 2 || text.length < 5) {
        await ctx.reply(t(user.language, "invalidFullName"));
        return;
      }

      user.fullName = text;
      user.step = "ASK_PHONE";
      await userService.setStep(user, "ASK_PHONE");
      await ctx.reply(t(user.language, "askPhone"), {
        reply_markup: phoneKeyboard(user.language),
      });
      return;
    }

    if (user.step === "ASK_PHONE") {
      const phone = normalizePhone(text);

      if (!phone) {
        await ctx.reply(t(user.language, "invalidPhone"), {
          reply_markup: phoneKeyboard(user.language),
        });
        return;
      }

      user.phone = phone;
      user.step = "ASK_REGION";
      await userService.setStep(user, "ASK_REGION");
      await askRegion(ctx);
      return;
    }

    if (user.step === "ASK_REGION") {
      const region = getRegion(text);

      if (!region) {
        await ctx.reply(t(user.language, "invalidRegion"), {
          reply_markup: regionInlineKeyboard(),
        });
        return;
      }

      user.address = region;
      user.selectedRegion = null;
      user.step = "MENU";
      await userService.setStep(user, "MENU");
      await ctx.reply(`${region} ${t(user.language, "regionSelected")}`);
      await sendRegistrationSuccess(ctx);
      return;
    }

    if (user.step === "ASK_DISTRICT") {
      const region = user.selectedRegion ? getRegion(user.selectedRegion) : null;

      if (!region) {
        await userService.setStep(user, "ASK_REGION");
        await askRegion(ctx);
        return;
      }

      if (!isDistrict(region, text)) {
        await ctx.reply(t(user.language, "invalidDistrict"), {
          reply_markup: districtInlineKeyboard(user.language, region),
        });
        return;
      }

      user.address = `${region}, ${text}`;
      user.selectedRegion = null;
      user.step = "MENU";
      await userService.setStep(user, "MENU");
      await ctx.reply(`${t(user.language, "savedProfile")}\n\n${t(user.language, "mainMenu")}`, {
        reply_markup: mainMenuKeyboard(user.language),
      });
      return;
    }

    if (user.step === "ASK_PROMO_CODE") {
      if (!isPromoConfigured()) {
        await userService.setStep(user, "MENU");
        await ctx.reply(`${t(user.language, "promoNotConfigured")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      const result = await promoCodeService.redeem(user, text);
      await userService.setStep(user, "MENU");

      if (result.status === "invalid_format") {
        await ctx.reply(`${t(user.language, "promoCodeInvalid")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      if (result.status === "not_found") {
        await ctx.reply(`${t(user.language, "promoCodeNotFound")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      if (result.status === "inactive") {
        await ctx.reply(`${t(user.language, "promoCodeInactive")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      if (result.status === "already_used") {
        await ctx.reply(`${t(user.language, "promoCodeAlreadyUsed")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      if (result.status === "payout_not_configured") {
        await ctx.reply(`${t(user.language, "promoPayoutNotConfigured")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      if (result.status === "phone_missing") {
        await ctx.reply(`${t(user.language, "promoPhoneMissing")}\n\n${t(user.language, "mainMenu")}`, {
          reply_markup: mainMenuKeyboard(user.language),
        });
        return;
      }

      const message =
        result.redemption.rewardAmount > 0
          ? [
              t(user.language, "promoCodeWinner"),
              `Yutuq: ${result.redemption.rewardAmount} so'm`,
              result.payoutStatus === "failed" ? t(user.language, "promoPayoutFailed") : t(user.language, "paynetAccepted"),
              "",
              t(user.language, "mainMenu"),
            ].join("\n")
          : `${t(user.language, "promoCodeNoPrize")}\n\n${t(user.language, "mainMenu")}`;

      await ctx.reply(message, {
        reply_markup: mainMenuKeyboard(user.language),
      });
      return;
    }

    await ctx.reply(t(user.language, "mainMenu"), {
      reply_markup: mainMenuKeyboard(user.language),
    });
  });
}
