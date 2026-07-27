# Promo Telegram Bot

Node.js + TypeScript + grammY + TypeORM + PostgreSQL asosidagi promo bot.

## Ishga tushirish

```bash
npm install
cp .env.example .env
docker compose up -d
npm run dev
```

`.env` ichida `BOT_TOKEN` va PostgreSQL sozlamalarini kiriting.
`ADDRESS_STICKER_ID` ixtiyoriy: berilsa, bot manzil tanlash qadamida sticker yuboradi.

Production uchun `NODE_ENV=production` qiling va TypeORM migration ishlating.

## Flow

1. `/start`
2. Ism sharif
3. Telefon raqam
4. Yashash manzili
5. Asosiy menyu

Menyuda promo kod yuborish, promo kodlar ro'yxati, kabinet/til o'zgartirish, oferta/media sahifalari bor.
