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

## Promo Payout / Digital Pay

Bot Digital Pay API orqali faqat yutuqli promokod uchun foydalanuvchi telefon raqamiga Paynet payout yaratadi. Foydalanuvchi menyudan mustaqil Paynet to'lov qila olmaydi.

```env
DIGITAL_PAY_BASE_URL=https://pay.adigital.uz
DIGITAL_PAY_TOKEN=auth_token
DIGITAL_PAY_USERNAME=login
DIGITAL_PAY_PASSWORD=password
DIGITAL_PAY_TIMEOUT_MS=15000
PAYNET_MIN_AMOUNT=1000
PAYNET_MAX_AMOUNT=1000000
HTTP_PORT=3000
PUBLIC_BASE_URL=https://your-domain.uz
```

Callback URL texnik yordamga shunday beriladi:

```text
https://your-domain.uz/callbacks/digital-pay
```

Digital Pay hujjatlariga ko'ra barcha so'rovlar `Basic Auth` va JSON body ichidagi `token` bilan yuboriladi. Telefon providerga 9 xonali lokal formatda yuboriladi, masalan `901234567`.

## Admin Panel

Dashboard `HTTP_PORT` dagi serverda ishlaydi:

```text
https://your-domain.uz/dashboard
```

IP bilan testda:

```text
http://161.35.219.212:3000/dashboard
```

`.env` ichida admin login/parolni albatta kuchli qilib qo'ying:

```env
DASH_LOGIN=admin
DASH_PASS=strong-random-password
DASH_COOKIE_SECURE=true
```

`DASH_COOKIE_SECURE=true` faqat HTTPS orqali ochilganda qo'yiladi. IP orqali oddiy HTTP test qilinayotgan bo'lsa vaqtincha `false` qoldiring.

Panelda dinamik chartlar, ishtirokchilar statistikasi, kiritilgan promokodlar, hududlar, Paynet statuslari, CSV eksport preview/yuklab olish va failed payoutlarni qayta yuborish bor. `DASH_LOGIN` yoki `DASH_PASS` bo'lmasa dashboard o'chirilgan bo'ladi.

## Promokodlar

Promokodlar bazada qidiruv uchun HMAC-SHA256 hash qilinadi. Dashboardda to'liq kod ko'rinishi uchun import paytida kod `PROMO_CODE_SECRET` dan olingan kalit bilan shifrlangan holda ham saqlanadi. Eski importlarda to'liq kod ko'rinmasa, migrationdan keyin Excelni qayta import qiling.

```env
PROMO_CODE_SECRET=kamida-32-belgili-random-secret
PROMO_DEFAULT_REWARD_AMOUNT=1000
```

Excel import:

```bash
npm run promo:import -- /home/kamoliddin/Downloads/100000_unikal_promokodlar.xlsx
```

`PROMO_DEFAULT_REWARD_AMOUNT=0` bo'lsa kod haqiqiy deb belgilanadi, lekin avtomatik Paynet yutuq o'tkazilmaydi. Yutuqli test uchun summani masalan `1000` qiling.

Alohida kodlarni yutuqli qilish:

```bash
npm run promo:winners -- 1000 4S46-37DL-VWGV-OE65 RQ0V-CFG7-2PAP-0FLF
```

Operatsion statistika:

```bash
npm run promo:stats
```

Failed Paynet payoutlarni qayta yuborish:

```bash
npm run paynet:retry-failed -- 20
```

## Production Deploy

Serverda `.env` ni to'g'ri to'ldiring va `NODE_ENV=production` qiling.

```bash
npm install
npm run build
npm run db:migrate
pm2 start ecosystem.config.js
pm2 save
```

Health check:

```bash
curl http://127.0.0.1:3000/health
```

`ok: true` va `database: "ok"` chiqishi kerak.

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

Production checklist:

- `.env` faylini gitga qo'shmang.
- Telegram bot token, Digital Pay token/parol, Postgres parol va server root parolini hech kimga yubormang; chatga tushgan bo'lsa rotate qiling.
- Domain va HTTPS qo'ying, keyin `PUBLIC_BASE_URL=https://your-domain.uz` va `DASH_COOKIE_SECURE=true` qiling.
- `DIGITAL_PAY_TIMEOUT_MS=15000` yoki undan yuqori qiling.
- Kunlik Postgres backup qo'ying.
- `/health`, `pm2 ls`, `pm2 logs promo-bot` va `/dashboard` panelni muntazam tekshiring.
- Failed/Pending Paynet bo'lsa avval sababini ko'ring, keyin dashboarddan retry qiling.
- Katta eksportlar uchun avval preview qiling, keyin CSV yuklab oling.

## Flow

1. `/start`
2. Ism sharif
3. Telefon raqam
4. Yashash manzili
5. Asosiy menyu

Menyuda promo kod yuborish, promo kodlar ro'yxati, kabinet/til o'zgartirish, oferta/media sahifalari bor. Paynet payout faqat yutuqli promokod ishlatilganda ichki jarayon sifatida bajariladi.
