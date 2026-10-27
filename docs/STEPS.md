# 🚀 الدليل التنفيذي خطوة بخطوة — من الصفر حتى Google Play

<div dir="rtl">

سلسلة تنفيذية بيد مارية: كل مرحلة أوامر حرفية جاهزة النسخ. المدة الكاملة 30–45 دقيقة.

---

## المرحلة أ — النشر الحي (Vercel + Neon) · ~10 دقائق

المخطط PostgreSQL حصرياً منذ v4.2 — القاعدة سحابية على Neon (مجانية) والاستضافة على Vercel.

1. ادفع مستودعك محلياً أو استخدم GitHub مباشرة (كودك جاهز على `main`).
2. **هيّئ قاعدة Neon أولاً**: أنشئ مشروعاً في [console.neon.tech](https://console.neon.tech) → انسخ السلسلتين (المجمّعة `-pooler` + المباشرة) → طبّق الترحيلات والبذر بأسهل طريق: زر **«Neon DB Setup»** في تبويب Actions بمستودعك (الوضع `catalog` لإنتاج نظيف) — التفاصيل في `docs/DEPLOYMENT.md` المسار 3.
3. افتح **vercel.com** → سجّل الدخول بـ GitHub → **Add New… → Project** → اختر `ruba-pharmacy` → **Import**.
4. Vercel يكتشف Next.js تلقائياً — اترك الإعدادات. في **Environment Variables** أضف الثلاثة الإلزامية (لكل البيئات):
   | الاسم | القيمة |
   |---|---|
   | `DATABASE_URL` | سلسلة Neon **المجمّعة** (`-pooler…?sslmode=require`) |
   | `DIRECT_URL` | سلسلة Neon **المباشرة** (`?sslmode=require`) — للترحيلات |
   | `AUTH_SECRET` | ناتج `openssl rand -hex 32` — إلزامي، بلاه يرفض الإنتاج التشغيل |
5. **Deploy** → انتظر ~دقيقتين → احفظ الرابط: `https://your-app.vercel.app`
6. تحقق: افتح الرابط، سجّل دخول بحساب بذرة تجريبي، وأنشئ فاتورة اختبار.
7. (اختياري لكن موصى به للعرض) فعّل HTTPS جاهز تلقائياً — لا خطوة إضافية.

### بديل الإنتاج: Docker على VPS (بيانات داخل الصيدلية — PostgreSQL محلي)
```bash
git clone https://github.com/magedmorshed173-ai/ruba-pharmacy && cd ruba-pharmacy
export AUTH_SECRET="$(openssl rand -hex 32)"   # إلزامي
docker compose up -d --build      # postgres + ترحيلات آلية + المنصة على :3000
# بيانات تجريبية اختيارية: docker compose run --rm seed
# ضع Caddy أمامها لـ HTTPS — التفاصيل في docs/DEPLOYMENT.md
```

---

## المرحلة ب — مفتاح التوقيع · ~3 دقائق

على جهازك (به JDK 17+):

```bash
cd ruba-pharmacy
bash scripts/make-keystore.sh     # يسألك اسم المتجر وكلمة مرور — احفظهما!
```

- الملف يُنشأ في `~/.ruba-play/ruba-upload.jks` + تُطبع **بصمة SHA-256** — انسخها.
- 🔐 **قاعدة ذهبية**: فقدان المفتاح = فقدان إمكانية تحديث التطبيق على Play. خُزّن نسخة في مدير كلمات.

---

## المرحلة ج — بناء الحزمة (AAB) · ~10 دقائق

```bash
LIVE_URL="https://your-app.vercel.app" \
KS_PASS="كلمة_المرور" \
bash scripts/build-twa.sh
```

ماذا يفعل السكربت: يثبّت Bubblewrap → يقرأ `manifest.webmanifest` من موقعك الحي → يولّد مشروع TWA باسم الحزمة `sa.rubapharmacy.app` → يبني **`app-release-bundle.aab`** موقّعاً ويطبع بصمتك.

**بديل بلا سطر أوامر**: افتح [pwabuilder.com](https://www.pwabuilder.com) → أدخل رابطك → Android → Package → ارفع keystoreك → نزّل AAB.

---

## المرحلة د — ربط الموقع بالتطبيق (Digital Asset Links) · ~5 دقائق

بدون هذه الخطوة سيظهر شريط «متصفح» فوق تطبيقك:

1. من بصمة المرحلة ب/ج أنشئ الملف:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "sa.rubapharmacy.app",
    "sha256_cert_fingerprints": ["انسخ_بصمتك_هنا"]
  }
}]
```

2. احفظه في المستودع: `public/.well-known/assetlinks.json` → ادفع → Vercel يعيد النشر تلقائياً.
3. تحقق: `https://your-app.vercel.app/.well-known/assetlinks.json` يفتح بالـ JSON.

---

## المرحلة هـ — Google Play Console · ~15 دقيقة + مراجعة

1. أنشئ حساب مطوّر ([play.google.com/console](https://play.google.com/console)) — رسم 25$ لمرة واحدة.
2. **Create app**: اسم «ربي فارمسي»، لغة عربية، تطبيق، مجاني.
3. **Test → Internal testing**: ارفع الـ AAB، أنشئ قائمة بريدك كمُختبِر، جرّب أسبوعاً.
4. أكمل **App content**: سياسة الخصوصية (جاهزة: `docs/PRIVACY_POLICY.md` — املأ الأقواس وارفعها كصفحة على موقعك أو Google Sites)، الإعلانات: لا، التصنيف، الجمهور المستهدف.
5. **Store listing** كامل (يلزم لكل عنصر):
   - أيقونة 512×512 → `public/pwa-512.png` جاهزة
   - صورة مميزة 1024×500 → صمّم من لقطة `docs/screenshots/dashboard.png`
   - لقطات هاتف 2–8 → اجعلها من التطبيق الحي (لوحة، POS، مخزون)
   - الوصف المختصر (80 حرفاً): «نظام متكامل لإدارة الصيدلية: بيع، مخزون بدفعات، تداخلات دوائية، تقارير»
6. **Production → Release**: ارفع الـ AAB → مراجعة Google (1–7 أيام عادة).
7. **إطلاق مرحلي** بعد القبول: 10% → 50% → 100% من المستخدمين (Production → Releases → Halt/Stage).

### دورة التحديث اللاحقة (كل إصدار)
```bash
# 1) عدّل --appVersionName="3.5.0" --appVersionCode=35 في scripts/build-twa.sh ثم أعد البناء
# 2) ارفع الـ AAB الجديد على نفس المسار Production → Releases
# 3) التوقيع بواسطة Play: فعّله (Setup → App signing) وابقَ تحتفظ بمفتاح الرفع
```

---

## قائمة فحص سريعة

- [ ] Neon مهيأة: ترحيلات + بذر عبر زر «Neon DB Setup»
- [ ] `DATABASE_URL` + `DIRECT_URL` + `AUTH_SECRET` مضبوطة في Vercel (الثلاثة)
- [ ] الرابط الحي يعمل + بيع تجريبي ناجح
- [ ] keystore محفوظ بمدير كلمات
- [ ] AAB يُبنى بلا أخطاء
- [ ] assetlinks.json حي على الرابط
- [ ] سياسة الخصوصية منشورة ومرتبطة
- [ ] لقطات + أيقونة + وصف مكتملان
- [ ] إطلاق داخلي ثم مرحلي

</div>
