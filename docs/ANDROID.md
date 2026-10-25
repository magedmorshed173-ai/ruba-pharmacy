# 📱 النشر على Google Play — دليل شامل (PWA → TWA)

<div dir="rtl">

منصة ربي فارمسي جاهزة أصلاً كـ **PWA متوافقة مع متطلبات Google Play** (manifest عربي RTL + أيقونات 192/512 + maskable). متجر Play يقبل تغليف الـ PWA كتطبيق **TWA (Trusted Web Activity)** — وهو المسار المعتمد والأوفر جهدًا مقارنة بإعادة بناء تطبيق أصلٍ (Native).

## خريطة الطريق

```
موقع PWA جاهز (✅ منجز) → نشر HTTPS → تغليف TWA (PWABuilder أو Bubblewrap)
→ توقيع AAB → Play Console → اختبار داخلي → إنتاج
```

## 0) المتطلبات المنجزة مسبقاً في هذا المشروع

| متطلب Play / TWA | الحالة |
|---|---|
| `manifest.webmanifest` باسم ووصف عربيين، `display: standalone` | ✅ مولَّد تلقائياً من `src/app/manifest.ts` |
| أيقونات 192×192 و512×512 | ✅ `public/pwa-192.png`, `pwa-512.png` |
| أيقونة Maskable (الشاشات الدائرية/التكيفية) | ✅ `maskable-192.png`, `maskable-512.png` |
| `theme_color` / `background_color` / `dir: rtl` / `lang: ar` | ✅ مضبوطة |
| عملة بلا أخطاء بناء | ✅ CI يفحص كل دفعة |

## 1) نشر الموقع عبر HTTPS

Play يتطلب نطاقاً حقيقياً يعمل عبر HTTPS ويتحكم به المالك. أسرع خيارين:
- **Vercel**: `vercel --prod` (راجع `DEPLOYMENT.md`) — يمنحك نطاقاً فوراً ويمكن ربط نطاقك الخاص.
- **VPS + Docker**: `docker compose up -d` خلف Caddy (TLS تلقائي).

> ثبّت النطاق النهائي الآن — سيُستخدم في كل الخطوات التالية (سنرمز له بـ `https://app.example.com`).

## 2) التثبيت المباشر كتطبيق (بدون متجر) — اختبار سريع

على هاتف أندرويد: افتح الرابط ← Chrome ← القائمة ← **«إضافة إلى الشاشة الرئيسية»**. يجب أن يظهر التطبيق بأيقونتك وبدون شريط المتصفح (standalone). إن نجح هذا فالتغليف سيصلح بلا مفاجآت.

## 3) التغليف كـ TWA

### الخيار (أ) — PWABuilder (الأسهل، واجهة رسومية)
1. ادخل [pwabuilder.com](https://www.pwabuilder.com) وضع رابط موقعك.
2. راجع تقرير الجاهزية (يجب أن يظهر أخضر لكل المتطلبات أعلاه).
3. اختر **Android** ← سيولّد حزمة TWA جاهزة:
   - `app-release-bundle.aab` (ملف الرفع إلى Play)
   - `assetlinks.json` (للمطابقة بين الموقع والتطبيق)
   - ملف توقيع `signing.keystore`

### الخيار (ب) — Bubblewrap CLI (للمطورين)
```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://app.example.com/manifest.webmanifest
# سيطرح أسئلة (النطاق، اسم التطبيق، الألوان) وينشئ مشروع TWA + keystore
bubblewrap build          # ينتج app-release-bundle.aab
```

> 🗝️ **احفظ `signing.keystore` + كلمات مروره في مكان آمن دائم** (مدير أسرار / نسخة مشفرة). فقدان التوقيع = لا تحديثات للتطبيق أبداً.

## 4) ربط الموقع بالتطبيق (Digital Asset Links)

لكي يعمل TWA **بدون شريط عنوان**، يجب أن يقر الموقع بالتطبيق:

1. احصل على بصمة SHA-256 لتوقيعك:
   ```bash
   keytool -list -v -keystore signing.keystore -alias android
   ```
2. ضع ملفاً على هذا المسار في الموقع:
   `https://app.example.com/.well-known/assetlinks.json`
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.ruba.pharmacy",
       "sha256_cert_fingerprints": ["<الصق البصمة هنا>"]
     }
   }]
   ```
   في هذا المشروع أضف الملف إلى `public/.well-known/assetlinks.json` ثم أعد النشر.

## 5) Play Console — خطوة بخطوة

1. سجّل **حساب مطور Google Play** (رسم لمرة واحدة ~25$).
2. **إنشاء تطبيق**: الاسم «ربي فارمسي»، لغة افتراضية **العربية**، تطبيق/لعبة = تطبيق، مجاني/مدفوع حسب نموذجك.
3. **قائمة المتجر (Store listing)**:
   - الاسم القصير ≤30 حرفاً: «ربي فارمسي»
   - الوصف الكامل ≤4000 حرفاً: انقل ما في `README.md` (المزايا + الأمان)
   - لقطات الشاشة: استخدم صور `docs/screenshots/` (هاتف + 7"/10" إن أردت)
   - أيقونة التطبيق 512×512 (نوفرها: `public/pwa-512.png`) + صورة مميزة 1024×500 (كوّنها من الشعار)
4. **تصنيف المحتوى (IARC)**: استبيان قصير — تطبيق صيدلي/إدارة، لا محتوى حساس.
5. **سلامة البيانات (Data safety)**: أجب وفق واقع نشرتك — نسختنا:
   - لا نجمع بيانات لمشاركتها مع أطراف ثالثة
   - بيانات الحساب (اسم مستخدم/كلمة مرور مشفرة bcrypt) تبقى على خادم الصيدلية
   - لا إعلانات، لا تتبع
6. **سياسة الخصوصية**: استضف `docs/PRIVACY_POLICY.md` على نطاقك (عدّله ليطابق كيانك القانوني) وضع الرابط في Play Console.
7. **الجمهور المستهدف**: صيدليات — لا يُوجَّه للأطفال (تجنب استبيان «تطبيقات الأطفال»).
8. **الإصدار**: ارفع `app-release-bundle.aab` على مسار **الاختبار الداخلي** أولاً، اختبر مع 5-20 مستخدماً، ثم اختبار مغلق، ثم **الإنتاج** (قد يستغرق المراجعة 1-7 أيام).
9. بعد القبول: استخدم **التتبع المرحلي (Staged rollout)** بنسبة 10% ← 50% ← 100%.

## 6) التزامات مستمرة بعد النشر

- **مستوى API المستهدف**: Play يشترط تبني آخر إصدارات Android سنوياً — Bubblewrap يحدّث هذا في `twa-manifest.json`؛ راجعه كل ربيع.
- حدّث الموقع (والـ TWA معه) بانتظام؛ الإصدارات المهجورة تُبلَّغ في Console.
- ردّ على التقييمات في Console — يرفع ترتيب البحث في المتجر.
- أي تغيير جوهري بمعالجة البيانات يستلزم تحديث نموذج Data safety وسياسة الخصوصية.

## 7) بديل متقدم: Capacitor (عند الحاجة لميزات أصلية)

إن احتجت لاحقاً كاميرا (مسح باركود)، أو إشعارات Push أصلية، أو طباعة حرارية:
```bash
npm i @capacitor/core @capacitor/cli
npx cap init ربي-فارمسي com.ruba.pharmacy --web-dir=public
npx cap add android && npx cap open android
```
يشارك Capacitor نفس واجهات API الموجودة، ويصدّر AAB للنشر بذات خطوات Play أعلاه.

</div>
