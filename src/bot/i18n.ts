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
  | "alreadyRegistered"
  | "registrationSuccess"
  | "congratulations"
  | "promoCodeAsk"
  | "promoCodeSaved"
  | "promoCodesEmpty"
  | "promoCodeInvalid"
  | "promoCodeNotFound"
  | "promoCodeAlreadyUsed"
  | "promoCodeInactive"
  | "promoCodeWinner"
  | "promoCodeNoPrize"
  | "promoPayoutFailed"
  | "promoPayoutNotConfigured"
  | "promoPhoneMissing"
  | "promoNotConfigured"
  | "paynetAccepted"
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
    alreadyRegistered: "Siz allaqachon ro'yxatdan o'tgansiz. Qayta ro'yxatdan o'tish shart emas.",
    registrationSuccess: "Siz muvaffaqiyatli ro'yxatdan o'tdingiz.",
    congratulations: "Tabriklaymiz!",
    promoCodeAsk: "Promo kodni yuboring:",
    promoCodeSaved: "Promo kod qabul qilindi.",
    promoCodesEmpty: "Sizda hali promo kodlar yo'q.",
    promoCodeInvalid: "Promo kod formati noto'g'ri. Masalan: ABCD-1234-EFGH-5678",
    promoCodeNotFound: "Bu promo kod bazada topilmadi.",
    promoCodeAlreadyUsed: "Bu promo kod avval ishlatilgan.",
    promoCodeInactive: "Bu promo kod faol emas.",
    promoCodeWinner: "Tabriklaymiz! Promo kod yutuqli.",
    promoCodeNoPrize: "Promo kod haqiqiy, lekin bu kod uchun yutuq belgilanmagan.",
    promoPayoutFailed: "Yutuq qabul qilindi, lekin to'lovni yuborishda xatolik bo'ldi. Operator tekshiradi.",
    promoPayoutNotConfigured: "Bu kod yutuqli, lekin Paynet integratsiyasi hali sozlanmagan. Kod ishlatilgan deb belgilanmadi.",
    promoPhoneMissing: "Bu kod yutuqli, lekin profilingizda telefon raqam yo'q. Kod ishlatilgan deb belgilanmadi.",
    promoNotConfigured: "Promokod tizimi sozlanmagan.",
    paynetAccepted: "Yutuq summasi telefon balansingizga yuborildi.",
    cabinet: "Kabinet",
    languageMenu: "Tilni tanlang:",
    terms: "📄 Promoaksiya shartlari hozircha tayyorlanmoqda.",
    media: "📲 Rasmiy media sahifalarimiz:",
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
    alreadyRegistered: "Вы уже зарегистрированы. Повторная регистрация не требуется.",
    registrationSuccess: "Вы успешно зарегистрировались.",
    congratulations: "Поздравляем!",
    promoCodeAsk: "Отправьте промокод:",
    promoCodeSaved: "Промокод принят.",
    promoCodesEmpty: "У вас пока нет промокодов.",
    promoCodeInvalid: "Неверный формат промокода. Например: ABCD-1234-EFGH-5678",
    promoCodeNotFound: "Этот промокод не найден в базе.",
    promoCodeAlreadyUsed: "Этот промокод уже использован.",
    promoCodeInactive: "Этот промокод не активен.",
    promoCodeWinner: "Поздравляем! Промокод выигрышный.",
    promoCodeNoPrize: "Промокод действительный, но приз для него не задан.",
    promoPayoutFailed: "Приз принят, но при отправке платежа произошла ошибка. Оператор проверит.",
    promoPayoutNotConfigured: "Этот промокод выигрышный, но Paynet интеграция еще не настроена. Код не был отмечен использованным.",
    promoPhoneMissing: "Этот промокод выигрышный, но в профиле нет номера телефона. Код не был отмечен использованным.",
    promoNotConfigured: "Система промокодов не настроена.",
    paynetAccepted: "Сумма выигрыша отправлена на баланс телефона.",
    cabinet: "Кабинет",
    languageMenu: "Выберите язык:",
    terms: "📄 Условия акции пока готовятся.",
    media: "📲 Наши официальные медиа страницы:",
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
