# 🚀 دليل النشر (Deployment)

<div dir="rtl">

ثلاثة مسارات مدعومة رسمياً، من الأسهل للأقوى. افترض أن لديك نسخة من المستودع و Bun مثبتاً للتطوير.

## المسار 1 — Vercel (الأسرع لبدء التشغيل)

1. اربط المستودع بـ [vercel.com](https://vercel.com) (New Project ← Import).
2. أضف متغير البيئة:
   ```
   DATABASE_URL=file:/tmp/custom.db
   ```
   > على Vercel الأنظمة عديمة القرار — للاستخدام الحقيقي انتقل إلى **PostgreSQL** (المسار 3) أو استضف على VPS.
3. Deploy — وسيُبنى تلقائياً في كل دفعة إلى `main` (CI يحمي الجودة).

## المسار 2 — VPS / Docker (موصى به للصيدليات — بيانات داخل الصيدلية)

```bash
git clone https://github.com/magedmorshed173-ai/ruba-pharmacy.git
cd ruba-pharmacy
docker compose up -d --build
# المنصة تعمل على http://SERVER-IP:3000 — البيانات في وحدة ruba-db الدائمة
```

### TLS تلقائي خلف Caddy (موصى به)

`Caddyfile`:
```
pharmacy.example.com {
  reverse_proxy ruba-pharmacy:3000
}
```
شغّل الحاويتين على شبكة Docker واحدة — Caddy يدير الشهادات تلقائياً.

### النسخ الاحتياطي

قاعدة SQLite ملف واحد — نسخ احتياطي يومي بحجم ثوانٍ:
```bash
docker exec ruba-pharmacy cat /app/db/custom.db | gzip > backup-$(date +%F).db.gz
```
كذلك نوفر نسخاً احتياطياً JSON من داخل المنصة: الإعدادات ← النسخ الاحتياطي.

## المسار 3 — Neon Postgres (v4.2 — الموصى به، مُطبّق في هذا المستودع)

المشروع رُحّل رسمياً إلى Neon Postgres — المخطط والسكربتات جاهزة:

1. أنشئ مشروعاً في [console.neon.tech](https://console.neon.tech) وانسخ السلسلتين (المجمّعة + المباشرة).
2. املأ `.env` (انظر `.env.example`):
   ```
   DATABASE_URL="postgresql://USER:PASS@ep-XXXX-pooler.REGION.aws.neon.tech/neondb?sslmode=require"
   DIRECT_URL="postgresql://USER:PASS@ep-XXXX.REGION.aws.neon.tech/neondb?sslmode=require"
   ```
   > المخطط مضبوط مسبقاً على `postgresql` مع `directUrl` — لا تعديل في الكود.
3. التهيئة الكاملة (مخطط + بذر + سجل مرخص):
   ```bash
   bunx prisma db push
   bun scripts/seed.ts && bun scripts/seed-drugs.ts && bun scripts/seed-national.ts
   ```
4. انشر بالطريقة 1 أو 2 مع متغيري البيئة نفسهين.

### مزايا Neon للصيدليات

- تجميد تلقائي للـ compute عند الخمول (توفير تكلفة ساعات الإغلاق)
- فروع قواعد بيانات (branching): نسخة تجريبية معزولة لكل ترقية قبل تطبيقها
- استرجاع نقطة زمنية (PITR) — أقوى من نسخ ملف SQLite اليدوي

### الاختبارات الحية على فرع مؤقت (v4.3)

جناح E2E يعمل على **فرع Neon مؤقت** تُنشئه الحاضنة وتحذفه تلقائياً — عزل
تام عن قاعدة الإنتاج مع باريتي كامل مع المخطط الفعلي:

```bash
bun run build && bun run test:e2e   # يتطلب NEON_API_KEY في .env
```

- بديل يدوي بلا مفتاح: `E2E_DATABASE_URL` (+ `E2E_DIRECT_URL`) لقاعدة Postgres جاهزة
- في CI: أضف أسرار الريبو `NEON_API_KEY` + `NEON_PROJECT_ID` + `NEON_PARENT_DATABASE_URL` — وبدونها تتخطى الخطوة بلطف
- تنظيف فروع الاختبار اليتيمة إن وجدت: `bun scripts/neon-clean-branches.ts`

### للمطورين المحليين (اختياري)

بديل SQLite ما يزال مدعوماً للتطوير دون اتصال: احذف `DIRECT_URL` واجعل `DATABASE_URL=file:./db/custom.db` مع إعادة provider إلى `sqlite` — لكن التوصية الرسمية الآن Neon حتى محلياً.

## قائمة فحص ما قبل الإنتاج ☑️

- [ ] تغيير كلمات مرور حسابات البذرة الثلاثة فوراً (المستخدمون ← كلمة المرور)
- [ ] `DATABASE_URL` يشير لقاعدة دائمة (وليس `/tmp`)
- [ ] HTTPS مفعل (كوكي المصادقة `Secure` لن يعمل بدونه على النطاقات)
- [ ] نسخ احتياطي مجدول ومُختبَر (استعادة فعلية مرة واحدة!)
- [ ] مراقبة سجلات الحاوية/الخادم
- [ ] `NEXT_TELEMETRY_DISABLED=1` إن رغبت بتعطيل التتبع

## الترقيات

```bash
git pull && docker compose up -d --build
```
سجل التغييرات لكل إصدار في `CHANGELOG.md` — راجعه قبل الترقية.
</div>
