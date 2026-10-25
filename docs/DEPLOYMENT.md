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

## المسار 3 — PostgreSQL (للتشغيل الواسع / سحابي)

1. أنشئ قاعدة (مثال Neon/Supabase/RDS) وانسخ رابط الاتصال.
2. عدّل `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. `bunx prisma db push && bun run scripts/seed.ts` ثم انشر بالطريقة 1 أو 2.
4. الصلاحية الوحيدة التي تتغير هي `provider` — كامل الكود محايد تجاه القاعدة.

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
