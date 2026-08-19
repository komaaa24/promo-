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

Admin panel `HTTP_PORT` dagi serverda ishlaydi:

```text
https://your-domain.uz/admin
```

IP bilan testda:

```text
http://161.35.219.212:3000/admin
```

`.env` ichida admin login/parolni albatta kuchli qilib qo'ying:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=strong-random-password
```

Panelda umumiy statistika, Paynet statuslari, promokod ishlatishlar, oxirgi to'lovlar va failed payoutlarni qayta yuborish tugmasi bor. `ADMIN_USERNAME` yoki `ADMIN_PASSWORD` bo'lmasa admin panel o'chirilgan bo'ladi.

## Promokodlar

Promokodlar bazada ochiq ko'rinishda saqlanmaydi. Import paytida har bir kod `PROMO_CODE_SECRET` bilan HMAC-SHA256 hash qilinadi, DB’da faqat hash va audit uchun oxirgi 4 belgi saqlanadi.

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

Productionda tavsiya:

- `.env` faylini gitga qo'shmang.
- Telegram, Digital Pay, Postgres va server root parollarini alohida saqlang.
- `DIGITAL_PAY_TIMEOUT_MS=15000` yoki undan yuqori qiling.
- Kunlik Postgres backup qo'ying.
- `pm2 logs promo-bot` va `/admin` panelni muntazam tekshiring.

## Flow

1. `/start`
2. Ism sharif
3. Telefon raqam
4. Yashash manzili
5. Asosiy menyu

Menyuda promo kod yuborish, promo kodlar ro'yxati, kabinet/til o'zgartirish, oferta/media sahifalari bor. Paynet payout faqat yutuqli promokod ishlatilganda ichki jarayon sifatida bajariladi.
