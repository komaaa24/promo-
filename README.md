# Promo Telegram Bot

Node.js + TypeScript + grammY + TypeORM + PostgreSQL asosidagi promo bot.

## Local Ishga Tushirish

```bash
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run dev
```

`.env` ichida `BOT_TOKEN` va PostgreSQL sozlamalarini kiriting.
`ADDRESS_STICKER_ID` ixtiyoriy: berilsa, bot manzil tanlash qadamida sticker yuboradi.
`SUCCESS_STICKER_ID` ixtiyoriy: berilsa, ro'yxatdan o'tish yakunida galochka sticker yuboradi.

## Production Deploy

Serverda `.env` ni to'g'ri to'ldiring va `NODE_ENV=production` qiling.

```bash
npm install
npm run build
npm run db:migrate
pm2 start ecosystem.config.js
pm2 save
```

Holat va loglarni ko'rish:

```bash
pm2 ls
pm2 logs promo-bot
```

Kod yangilangandan keyin:

```bash
npm install
npm run build
npm run db:migrate
pm2 restart promo-bot
```

Productionda TypeORM `synchronize` o'chirilgan. Jadvallar faqat migration orqali boshqariladi.

## Flow

1. `/start`
2. Ism sharif
3. Telefon raqam
4. Yashash manzili
5. Asosiy menyu

Menyuda promo kod yuborish, promo kodlar ro'yxati, kabinet/til o'zgartirish, oferta/media sahifalari bor.
