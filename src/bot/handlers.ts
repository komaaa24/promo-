import { Bot } from "grammy";
import { BotContext } from "./types";
import {
  buttons,
  cabinetKeyboard,
  districtInlineKeyboard,
  languageKeyboard,
  mainMenuKeyboard,
  phoneKeyboard,
  regionInlineKeyboard,
} from "./keyboards";
import { t } from "./i18n";
import { LanguageCode } from "../entities/TelegramUser";
import { UserService } from "./user-service";
import { getDistrictByIndex, getRegion, getRegionByIndex, isDistrict, Region } from "./locations";
import { env } from "../config/env";

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

async function repeatCurrentStep(ctx: BotContext): Promise<void> {
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

  await ctx.reply(t(user.language, "mainMenu"), {
    reply_markup: mainMenuKeyboard(user.language),
  });
}

export function registerHandlers(bot: Bot<BotContext>, userService: UserService): void {
  bot.command("start", async (ctx) => {
    ctx.dbUser.step = "ASK_FULL_NAME";
    await userService.setStep(ctx.dbUser, "ASK_FULL_NAME");
    await ctx.reply(`${t(ctx.dbUser.language, "start")}\n\n${t(ctx.dbUser.language, "askFullName")}`, {
      reply_markup: languageKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.promoSend, buttons.ru.promoSend], async (ctx) => {
    await userService.setStep(ctx.dbUser, "ASK_PROMO_CODE");
    await ctx.reply(t(ctx.dbUser.language, "promoCodeAsk"), {
      reply_markup: languageKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.promoMine, buttons.ru.promoMine], async (ctx) => {
    const codes = await userService.listPromoCodes(ctx.dbUser);

    if (codes.length === 0) {
      await ctx.reply(t(ctx.dbUser.language, "promoCodesEmpty"), {
        reply_markup: mainMenuKeyboard(ctx.dbUser.language),
      });
      return;
    }

    const list = codes
      .map((promoCode, index) => `${index + 1}. ${promoCode.code}`)
      .join("\n");

    await ctx.reply(list, { reply_markup: mainMenuKeyboard(ctx.dbUser.language) });
  });

  bot.hears([buttons.uz.cabinet, buttons.ru.cabinet], async (ctx) => {
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
      reply_markup: mainMenuKeyboard(ctx.dbUser.language),
    });
  });

  bot.hears([buttons.uz.languageUz, buttons.ru.languageUz], async (ctx) => {
    ctx.dbUser.language = "uz";
    await userService.setStep(ctx.dbUser, ctx.dbUser.step);
    await ctx.reply(t("uz", "languageChanged"), {
      reply_markup: languageKeyboard("uz"),
    });
    await repeatCurrentStep(ctx);
  });

  bot.hears([buttons.uz.languageRu, buttons.ru.languageRu], async (ctx) => {
    ctx.dbUser.language = "ru";
    await userService.setStep(ctx.dbUser, ctx.dbUser.step);
    await ctx.reply(t("ru", "languageChanged"), {
      reply_markup: languageKeyboard("ru"),
    });
    await repeatCurrentStep(ctx);
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
      await userService.savePromoCode(user, text);
      await userService.setStep(user, "MENU");
      await ctx.reply(`${t(user.language, "promoCodeSaved")}\n\n${t(user.language, "mainMenu")}`, {
        reply_markup: mainMenuKeyboard(user.language),
      });
      return;
    }

    await ctx.reply(t(user.language, "mainMenu"), {
      reply_markup: mainMenuKeyboard(user.language),
    });
  });
}
