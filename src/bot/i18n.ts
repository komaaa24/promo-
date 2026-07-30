import { LanguageCode } from "../entities/TelegramUser";

type MessageKey =
  | "start"
  | "askFullName"
  | "askPhone"
  | "askRegion"
  | "askDistrict"
  | "invalidRegion"
  | "invalidDistrict"
  | "mainMenu"
  | "sendPhoneButton"
  | "invalidFullName"
  | "invalidPhone"
  | "savedProfile"
  | "registrationSuccess"
  | "congratulations"
  | "promoCodeAsk"
  | "promoCodeSaved"
  | "promoCodesEmpty"
  | "cabinet"
  | "languageMenu"
  | "terms"
  | "media"
  | "offerMedia"
  | "languageChanged"
  | "regionSelected"
  | "districtSelected"
  | "unknown";

const messages: Record<LanguageCode, Record<MessageKey, string>> = {
  uz: {
    start: "Assalomu alaykum! Ro'yxatdan o'tishni boshlaymiz.",
    askFullName: "Ism sharifingizni kiriting:",
    askPhone: "Telefon raqamingizni yuboring:",
    askRegion: "🌐 Siz yashaydigan shaharni tanlang:",
    askDistrict: "📍 Tuman yoki shahringizni tanlang:",
    invalidRegion: "Iltimos, ro'yxatdan viloyat yoki shaharni tanlang.",
    invalidDistrict: "Iltimos, ro'yxatdan tuman yoki shaharni tanlang.",
    mainMenu: "Asosiy menyu",
    sendPhoneButton: "Telefon raqamni yuborish",
    invalidFullName: "Iltimos, ism va familiyangizni to'liq kiriting.",
    invalidPhone: "Telefon raqam noto'g'ri. Masalan: +998901234567",
    savedProfile: "Ma'lumotlaringiz saqlandi.",
    registrationSuccess: "Siz muvaffaqiyatli ro'yxatdan o'tdingiz.",
    congratulations: "Tabriklaymiz!",
    promoCodeAsk: "Promo kodni yuboring:",
    promoCodeSaved: "Promo kod qabul qilindi.",
    promoCodesEmpty: "Sizda hali promo kodlar yo'q.",
    cabinet: "Kabinet",
    languageMenu: "Tilni tanlang:",
    terms: "📄 Promoaksiya shartlari hozircha tayyorlanmoqda.",
    media: "📲 Media sahifalar hozircha tayyorlanmoqda.",
    offerMedia: "Oferta va media sahifalari hozircha tayyorlanmoqda.",
    languageChanged: "Til o'zgartirildi.",
    regionSelected: "tanlandi ✅",
    districtSelected: "Manzil tanlandi ✅",
    unknown: "Buyruq tushunarsiz. Menyudan foydalaning.",
  },
  ru: {
    start: "Здравствуйте! Начинаем регистрацию.",
    askFullName: "Введите имя и фамилию:",
    askPhone: "Отправьте номер телефона:",
    askRegion: "🌐 Выберите ваш регион:",
    askDistrict: "📍 Выберите район или город:",
    invalidRegion: "Пожалуйста, выберите регион из списка.",
    invalidDistrict: "Пожалуйста, выберите район или город из списка.",
    mainMenu: "Главное меню",
    sendPhoneButton: "Отправить номер",
    invalidFullName: "Пожалуйста, введите имя и фамилию полностью.",
    invalidPhone: "Неверный номер телефона. Например: +998901234567",
    savedProfile: "Ваши данные сохранены.",
    registrationSuccess: "Вы успешно зарегистрировались.",
    congratulations: "Поздравляем!",
    promoCodeAsk: "Отправьте промокод:",
    promoCodeSaved: "Промокод принят.",
    promoCodesEmpty: "У вас пока нет промокодов.",
    cabinet: "Кабинет",
    languageMenu: "Выберите язык:",
    terms: "📄 Условия акции пока готовятся.",
    media: "📲 Медиа страницы пока готовятся.",
    offerMedia: "Оферта и медиа страницы пока готовятся.",
    languageChanged: "Язык изменен.",
    regionSelected: "выбран ✅",
    districtSelected: "Адрес выбран ✅",
    unknown: "Команда не распознана. Используйте меню.",
  },
};

export function t(language: LanguageCode, key: MessageKey): string {
  return messages[language][key];
}
