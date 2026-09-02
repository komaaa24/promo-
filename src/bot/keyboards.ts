import { InlineKeyboard, Keyboard } from "grammy";
import { LanguageCode } from "../entities/TelegramUser";
import { t } from "./i18n";
import { districtsByRegion, Region, regions } from "./locations";

export const buttons = {
  uz: {
    promoSend: "🎁 Promokod yuborish",
    promoMine: "🛍 Mening promokodlarim",
    cabinet: "👤 Shaxsiy Kabinet",
    language: "🌐 Tilni o'zgartirish",
    terms: "📄 Promoaksiya shartlari",
    media: "📲 Media sahifalar",
    languageUz: "🇺🇿 O'zbekcha",
    languageRu: "🇷🇺 Русский",
    changeRegion: "⬅️ Viloyatni qayta tanlash",
    back: "Orqaga",
  },
  ru: {
    promoSend: "🎁 Отправить промокод",
    promoMine: "🛍 Мои промокоды",
    cabinet: "👤 Личный кабинет",
    language: "🌐 Сменить язык",
    terms: "📄 Условия акции",
    media: "📲 Медиа страницы",
    languageUz: "🇺🇿 O'zbekcha",
    languageRu: "🇷🇺 Русский",
    changeRegion: "⬅️ Выбрать регион заново",
    back: "Назад",
  },
} satisfies Record<LanguageCode, Record<string, string>>;

export function phoneKeyboard(language: LanguageCode): Keyboard {
  const b = buttons[language];

  return new Keyboard()
    .requestContact(t(language, "sendPhoneButton"))
    .row()
    .text(b.languageUz)
    .text(b.languageRu)
    .resized()
    .oneTime();
}

export function languageKeyboard(language: LanguageCode): Keyboard {
  const b = buttons[language];

  return new Keyboard()
    .text(b.languageUz)
    .text(b.languageRu)
    .resized()
    .persistent();
}

export function regionInlineKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  regions.forEach((region, index) => {
    keyboard.text(region, `region:${index}`).row();
  });

  return keyboard;
}

export function districtInlineKeyboard(language: LanguageCode, region: Region): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const regionIndex = regions.indexOf(region);

  districtsByRegion[region].forEach((district, index) => {
    keyboard.text(district, `district:${regionIndex}:${index}`).row();
  });

  return keyboard.text(buttons[language].changeRegion, "location:regions");
}

export function mainMenuKeyboard(language: LanguageCode): Keyboard {
  const b = buttons[language];

  return new Keyboard()
    .text(b.promoSend)
    .text(b.promoMine)
    .row()
    .text(b.cabinet)
    .text(b.language)
    .row()
    .text(b.terms)
    .text(b.media)
    .resized();
}

export function mediaInlineKeyboard(language: LanguageCode): InlineKeyboard {
  const labels =
    language === "uz"
      ? {
          instagram: "Instagram",
          telegram: "Telegram kanal",
          website: "Saytimiz",
        }
      : {
          instagram: "Instagram",
          telegram: "Telegram канал",
          website: "Наш сайт",
        };

  return new InlineKeyboard()
    .url(labels.instagram, "https://www.instagram.com/oilux.uz/")
    .row()
    .url(labels.telegram, "https://t.me/Oilux_Uz")
    .row()
    .url(labels.website, "https://asrgroup.uz/uz/company/oilux");
}

export function cabinetKeyboard(language: LanguageCode): Keyboard {
  const b = buttons[language];

  return new Keyboard()
    .text(b.languageUz)
    .text(b.languageRu)
    .row()
    .text(b.back)
    .resized();
}
