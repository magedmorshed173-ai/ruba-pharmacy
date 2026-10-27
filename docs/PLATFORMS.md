<div dir="rtl">

# 💻 صيدلية رُبى على كل المنصات — دليل التحميل والتثبيت (v4.6.6)

نظام واحد يُشغَّل كتطبيق مستقل على كل جهازك، أو كخادم ذاتي الاستضافة تتحكم
ببياناتك بالكامل. هذه خريطة الطرق المدعومة:

| المنصة | الطريقة الأسهل | بديل متقدم |
|---|---|---|
| **أندرويد** | PWA: «تثبيت التطبيق» من Chrome | حزمة TWA لـ Google Play (`docs/ANDROID.md`) · خادم محلي بـ Termux |
| **iPhone / iPad** | PWA: «إضافة إلى الشاشة الرئيسية» من Safari | — |
| **ويندوز** | PWA من Edge/Chrome | مثبّت `install.ps1` · Docker Desktop · WSL2 |
| **macOS** | PWA من Chrome/Edge (يظهر في Dock) | مثبّت `install.sh` · Docker |
| **لينكس** | مثبّت `install.sh` بأمر واحد | Docker Compose · خدمة systemd |
| **Termux (أندرويد)** | أمر واحد — يجهّز Debian داخل proot تلقائياً | تشغيل يدوي بداخل proot |

> 🌐 **الرابط الحي السحابي:** <https://ruba-pharmacy.vercel.app> — افتحه في أي
> جهاز واضغط «تثبيت التطبيق» (صفحة `/download` داخل التطبيق تحتوي أزراراً
> تفاعلية وأوامر قابلة للنسخ لكل منصة).

---

## 1) التثبيت كتطبيق — PWA (كل المنصات، بلا تنزيلات)

المنصة مبنية كـ **PWA متكاملة** (manifest عربي RTL + أيقونات 192/512 + maskable +
تشغيل standalone) — أي متصفح حديث يحوّلها إلى تطبيق مستقل بأيقونتها:

- **أندرويد (Chrome/Edge):** افتح الرابط ← القائمة ⋮ ← **«تثبيت التطبيق»**.
- **آيفون/آيباد (Safari فقط):** زر المشاركة ⬆ ← **«إضافة إلى الشاشة الرئيسية»**.
- **ويندوز (Edge/Chrome):** أيقونة التثبيت في شريط العنوان ← **«تثبيت»** — يظهر
  في قائمة ابدأ ويمكن تثبيته في شريط المهام.
- **macOS (Chrome/Edge):** أيقونة التثبيت ← يُضاف إلى **Dock** ومجلد التطبيقات.
- **لينكس (Chrome/Chromium/Edge):** أيقونة التثبيت ← يُنشأ مُدخل سطح مكتب
  (`.desktop`) تلقائياً في قائمة التطبيقات.

بعد التثبيت يعمل التطبيق بلا شريط متصفح، ومع تحديث تلقائي عند كل فتح (على عكس
التطبيقات التقليدية — لا حاجة لتحديث من متجر).

### العمل دون اتصال — Offline (v4.8.0)

Service Worker كامل يجعل التثبيت يستحق اسمه:

- **الصفحات المزارة خلال آخر ساعة** تبقى قابلة للتصفح دون إنترنت (خبز ذكي
  بصلاحية ساعة — لا نسخ قديمة تعيش بعد إقفال النظام).
- **الأصول الثابتة** (الواجهة، الخطوط، الأيقونات) تُحمل فوراً من الذاكرة
  المحلية مع تحديث تلقائي بالخلفية — سرعة إطلاق أعلى حتى مع الاتصال.
- **بيانات النظام الحية** (`/api/*`) لا تُخبَّز محلياً إطلاقاً — وإنقطاع
  الشبكة أثناء العمل يظهر بشريط عدم الاتصال الموجود أصلاً.
- عند إقفال النظام (انتهاء المفتاح/سحبه/تغيير كلمة المرور) تُمحى الذاكرة
  المحلية فوراً — الأمان لا يتراخى للعمل دون اتصال.
- قفل النظام ينبهك **قبل انتهائه بـ 10 دقائق** مع زر تمديد داخلي يبقيك في
  مكانك بلا خسارة أي عمل.

## 2) أندرويد — حزمة Google Play (TWA/AAB)

لنشر رسمي على Play أو توزيع ملف APK مباشرة، المشروع جاهز بخطوة واحدة
(تغليف Trusted Web Activity — المسار المعتمد من Google لتطبيقات الويب):

```bash
# على أي حاسب فيه Node.js:
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://ruba-pharmacy.vercel.app/manifest.webmanifest
bubblewrap build      # ينتج app-release-bundle.aab جاهزاً للتوقيع والرفع
```

التفصيل الكامل (PWABuilder البديل الرسومي، توقيع المفاتيح، Digital Asset Links)
موثق خطوة بخطوة في **`docs/ANDROID.md`**، وسكربت المساعدة في
`scripts/build-twa.sh`.

## 3) أندرويد — Termux: خادم كامل داخل الهاتف

مثالي للعمل بلا إنترنت داخل الصيدلية: هاتف/تابلت يخدم بقية الأجهزة عبر
شبكة الـ Wi-Fi المحلية. المثبّت يكتشف Termux ويجهّز **Debian داخل proot**
(بيئة glibc كاملة بلا جذر root — آمنة ومعزولة) ثم يكمل تلقائياً:

```bash
# داخل Termux (ثبّته من F-Droid أو Play):
pkg update && pkg install curl -y
curl -fsSL https://raw.githubusercontent.com/magedmorshed173-ai/ruba-pharmacy/main/scripts/install.sh | bash
```

- بعد الانتهاء: افتح `http://localhost:3000` على الهاتف نفسه، أو
  `http://<عنوان-الهاتف>:3000` من أي جهاز في نفس الشبكة (يظهر العنوان في
  نهاية التثبيت).
- للدخول إلى البيئة لاحقاً: `proot-distro login debian`
- **ملاحظة أداء:** الهاتف الحديث (4GB+ RAM) كافٍ؛ البناء الأول يستغرق عدة
  دقائق ثم يُخزَّن.

## 4) لينكس — المثبّت الشامل (Debian/Ubuntu/Fedora/Arch/Alpine/WSL)

```bash
curl -fsSL https://raw.githubusercontent.com/magedmorshed173-ai/ruba-pharmacy/main/scripts/install.sh | bash
```

ماذا يفعل؟ يكتشف بيئتك → يثبّت Bun (أو Node 22 محلياً بلا صلاحيات جذر) →
ينسخ المشروع → يسألك عن قاعدة البيانات (Neon سحابية بالصق السلسلة المجمّعة، أو
محلية) → يولّد `AUTH_SECRET` → يطبّق الترحيلات → يبني ويشغّل على المنفذ 3000
ويطبع عنوان الشبكة المحلية.

خيارات مفيدة:

```bash
bash install.sh --seed=catalog     # بذر كتالوج الدواء والسجل الوطني (إنتاج نظيف)
bash install.sh --seed=full        # بيانات تجريبية كاملة (للتجربة فقط)
bash install.sh --service          # خدمة systemd للمستخدم — إقلاع تلقائي
bash install.sh --docker           # كل شيء داخل Docker Compose
bash install.sh --port=8080 --no-run
```

- **التحديث لاحقاً:** `cd ~/ruba-pharmacy && git pull && bash scripts/install.sh`
- **إيقاف/تشغيل يدوي:** `kill $(cat .server.pid)` ثم
  `PORT=3000 NODE_ENV=production node .next/standalone/server.js`
- **TLS للشبكة العامة:** ضع وكيلاً عكسياً (Caddy/Nginx) — انظر
  `docs/DEPLOYMENT.md`.

### الخادم الدائم — systemd

```bash
bash scripts/install.sh --service --seed=catalog
systemctl --user status ruba-pharmacy
sudo loginctl enable-linger $USER   # ليعمل حتى بعد خروجك من الجلسة
```

## 5) ويندوز — مثبّت PowerShell أصلي

```powershell
irm https://raw.githubusercontent.com/magedmorshed173-ai/ruba-pharmacy/main/scripts/install.ps1 | iex
```

يتكفل بكل شيء: تثبيت Git وNode/Bun عبر winget، نسخ المشروع، إعداد `.env`
(إدخال مخفي للسلاسل)، الترحيلات، البناء (سكربتنا عابر للمنصات — بلا أوامر
يونكسية)، ثم التشغيل وفتح المتصفح. يفضّل Docker تلقائياً إن وجده.

> بديل WSL2: ثبّت Ubuntu من المتجر ثم استخدم مثبّت لينكس أعلاه حرفياً.

## 6) Docker — أي خادم (VPS/NAS/سطح مكتب)

```bash
git clone --depth 1 https://github.com/magedmorshed173-ai/ruba-pharmacy.git
cd ruba-pharmacy
export AUTH_SECRET="$(openssl rand -hex 32)"   # إلزامي — fail-closed
docker compose up -d --build
# بيانات تجريبية (اختياري): docker compose run --rm seed
```

يشمل: قاعدة PostgreSQL 16 بوحدة تخزين دائمة + ترحيلات تلقائية عند الإقلاع +
المنصة على المنفذ 3000 مع فحص صحة حي.

## 7) قاعدة البيانات: سحابية أم محلية؟

| الخيار | مناسب لـ | كيف؟ |
|---|---|---|
| **Neon سحابية** | الوصول من كل الأجهزة في أي مكان (مثل نشرنا الحي) | Vercel → Storage → Neon → انسخ السلسلة المجمّعة والصقها في المثبّت |
| **Postgres محلية** | خصوصية كاملة / عمل داخل الصيدلية | Docker (`postgres:16-alpine`) أو تثبيت مباشر — ثم `postgresql://…@localhost:5432/ruba` |

المخطط واحد (PostgreSQL حصرياً منذ v4.2) والترحيلات تُطبَّق آلياً في الحالتين.

## 8) متطلبات النظام

| المكوّن | الحد الأدنى | مريح |
|---|---|---|
| المعالج | 2 أنوية | 4 أنوية |
| الذاكرة | 1 GB | 2 GB+ |
| بيئة التشغيل | Node.js 20.9+ أو Bun 1.2+ | آخر إصدار LTS |
| القرص | ~600 MB (بعد البناء) | 1 GB+ |
| للجوال (Termux) | أندرويد 9+ | 4 GB RAM+ |

## 9) روابط رسمية

- التطبيق الحي: <https://ruba-pharmacy.vercel.app>
- صفحة التحميل التفاعلية: <https://ruba-pharmacy.vercel.app/download>
- المستودع: <https://github.com/magedmorshed173-ai/ruba-pharmacy>
- إصدار v4.6.6 (أصول التحميل: install.sh / install.ps1 / docker-compose.yml):
  <https://github.com/magedmorshed173-ai/ruba-pharmacy/releases/tag/v4.6.6>

</div>
