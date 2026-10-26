<div dir="rtl" align="center">

# 💊 ربي فارمسي — نظام إدارة الصيدليات العربي المتكامل

**منصة متكاملة لإدارة الصيدلية: نقطة بيع ببوابة سلامة دوائية حية، مخزون بدفعات FEFO، موردون وأوامر شراء، تقارير ربحية بالتكلفة الفعلية — واجهة عربية RTL، مفتوح المصدر بالكامل.**

🌐 **صفحة المشروع الحية:** <https://magedmorshed173-ai.github.io/ruba-pharmacy/>

![CI](https://github.com/magedmorshed173-ai/ruba-pharmacy/actions/workflows/ci.yml/badge.svg)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?logo=pwa&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-Latest-000000?logo=shadcnui&logoColor=white)
![License MIT](https://img.shields.io/badge/License-MIT-green)

</div>

---

<div dir="rtl">

## 📸 نظرة سريعة

| لوحة التحكم | نقطة البيع الذكية |
|:---:|:---:|
| ![لوحة التحكم](docs/screenshots/dashboard.png) | ![نقطة البيع](docs/screenshots/pos.png) |

| تسجيل الدخول | تحذيرات التداخلات الدوائية الحية |
|:---:|:---:|
| ![تسجيل الدخول](docs/screenshots/login.png) | تحذير فوري عند الجمع بين **وارفارين + أسبرين** (خطر نزف) مباشرة في سلة البيع |

## ✨ المزايا

### 🛒 نقطة البيع (POS)
- سلة بيع تفاعلية مع بحث فوري بالاسم أو الباركود
- **بوابة السلامة الدوائية الحية (v3.5)**: تداخلات بأربع درجات شدة مع الآلية الدوائية والأثر السريري وخطة الإدارة والمصدر العلمي؛ «ممنوع سريرياً» وتعارض الحساسية يحجبان البيع (الفني دائماً، والصيدلي يتجاوز بتأكيد مسؤول يُسجل في الفاتورة)
- خصومات، طرق دفع متعددة (نقدي/شبكة)، فاتورة رقمية بعد البيع
- **Idempotency**: مرجع فريد لكل عملية يمنع البيع المكرر عند ضعف الشبكة
- إلغاء واسترجاع كامل للفواتير مع إعادة الكميات تلقائياً

### 📦 المخزون والتنبؤ
- إدارة كاملة للأدوية (30 دواء عربي مُحمَّل جاهزاً) مع التصنيفات
- **دفعات التشغيلة (LOT)** بصلاحية مستقلة + **صرف FEFO** آلي: الأقرب انتهاءً يُصرف أولاً، والمنتهي محجوب حتى لو ظهر الرصيد متاحاً
- سجل تدقيق **StockMovement** لكل حركة إدخال/إخراج — لا رقم يختفي
- **تنبؤ إعادة الطلب** الذكي بناءً على معدل الاستهلاك اليومي ومهلة التوريد
- تنبيهات انخفاض المخزون ونفاد الأصناف عبر مركز إشعارات بمفتاح `dedupeKey` فريد

### 🚚 المشتريات والموردون (v3.2)
- سجل موردون كامل (اسم، جوال، بريد، عنوان، حالة تفعيل) مع عدد أوامر كل مورد
- **أوامر شراء (Purchase Orders)** ببنود متعددة: دواء، كمية، تكلفة وحدة، تشغيلة، صلاحية — إجمالي يُحسب خادمياً بالهللات
- **استلام ذري**: لكل بند دفعة LOT بالتكلفة الفعلية + تحديث الرصيد وأقرب صلاحية + حركة مخزون مُدقَّقة — التشغيلة الموجودة تُدمج، والتكرار محجوب (409)
- التشغيلة التلقائية `PO-<رقم الأمر>-<تسلسل>` عند غيابها

### 👥 المرضى والرعاية
- ملفات مرضى مع الأمراض المزمنة والحساسية، وربط المريض بالفاتورة عند البيع
- **مطابقة حساسية متقاطعة (v3.5)**: حساسية «بنسلين» تحجب أموكسيسيلين وأوجمنتين تلقائياً عبر عائلات دوائية معرفة علمياً
- **كشف العلاج المكرر (v3.5)**: أدوية من نفس الفئة العلاجية (ATC) داخل السلة تُرصد كمكررة
- فحص التداخلات مرتبط بسجل المريض المزمن — سلامة دوائية حقيقية

### 🧬 القاعدة السريرية (v3.5)
- **26 تداخلاً دوائياً موثقاً** بعد نمط Lexicomp/Stockley: كل سجل يضم الشدة (ممنوع سريرياً/خطير/متوسط/بسيط)، الآلية الدوائية (تثبيط CYP2C9، شيلات، تأثير جمعي…)، الأثر السريري المحتمل، خطة الإدارة، مستوى الأدلة، والمصدر العلمي، وزمن البدء
- تصنيف **ATC** لكل دواء + حد أقصى للجرعة اليومية على مستوى قاعدة البيانات

### 📊 التقارير والذكاء
- لوحة تحكم بمؤشرات KPI حية: مبيعات اليوم، إيراد الشهر، قيمة المخزون، تنبيهات
- رسوم بيانية (Recharts): حركة الإيرادات اليومية + توزيع التصنيفات
- **تقارير أرباح بالتكلفة الفعلية (v3.3)**: لقطة تكلفة الدفعات FEFO عند البيع → ربح وهامش حقيقيان لكل دواء وفترة، مع رسم يومي — لا تقديرات
- **سجل تدقيق الدخول (v3.3)**: كل محاولة نجاح/فشل مع IP — عدّاد «فشل/24 ساعة» للمدير
- تقارير مبيعات بفلاتر تاريخ وحالة، **تصدير CSV** بترميز UTF-8-BOM يفتح مباشرة في Excel العربي

### 🔐 الأمان — مراجعة هندسية حقيقية
هذه النسخة نتجت عن **مراجعة أمنية شاملة** أصلحت أبرز ثغرات الأنظمة المشابهة:

| الثغرة | الإصلاح |
|---|---|
| فحص الدور داخل الـ handler بعد اجتياز DRF (يتجاوزه الفني) | فحص دور مركزي في **كل** endpoint قبل التنفيذ — `403` للفني على التعبئة |
| تضارب أنواع الكميات (Decimal مقابل Int) | النقود بالهللات (Integer) — دقة مالية مطلقة، بلا أخطاء فاصلة عائمة |
| دمج الإشعارات عبر `title__contains` الهش | مفتاح `dedupeKey` فريد لكل تنبيه |
| فحص التداخلات غير مربوط بنقطة البيع | **بوابة سلامة دوائية** في مسار البيع نفسه: حجب «ممنوع سريرياً» + تعارض الحساسية، مع تجاوز مسؤول مسجّل |
| لا رؤوس أمان على الاستجابات | **CSP + HSTS + X-Frame-Options + Referrer-Policy + Permissions-Policy** على كل استجابة (v3.5) |
| كلمات مرور؟ | `bcrypt` + JWT (jose) في كوكي `httpOnly` — لا توكن في localStorage |

## 🧱 التقنيات

- **Next.js 16** (App Router) + **TypeScript 5**
- **Prisma 6** + SQLite (جاهز للترقية إلى PostgreSQL بتغيير واحد)
- **Tailwind CSS 4** + **shadcn/ui** + **Recharts** + وضع ليلي
- خط **Tajawal** العربي، ثيم طبي Teal، دعم RTL كامل
- **51 اختباراً وحدوياً** (Vitest — `bun run test`) تغطي المال وFEFO والأرباح والمحرك السريري
- **63 فحصاً حياً E2E** (`bun run test:e2e`): خادم إنتاجي حقيقي + قاعدة بيانات حقيقية + HTTP فعلي — من المصادقة إلى بوابة «ممنوع سريرياً» وFEFO واسترجاع المخزون — يعمل في CI على كل دفعة
- **PWA جاهز للتثبيت والنشر على Google Play** (TWA) — راجع [docs/ANDROID.md](docs/ANDROID.md)
- **Docker** متعدد المراحل + `docker-compose` للتشغيل الفوري داخل الصيدلية
- **CI/CD**: فحص lint + بناء إنتاج في كل دفعة، وDependabot أسبوعي للتبعيات
- اختبار تحقّق كامل عبر متصفح آلي (دخول ← بيع ← تداخل دوائي ← تقارير ← جوال 390px)

## 🏢 حوكمة بمعايير الشركات

| الوثيقة | الغرض |
|---|---|
| [SECURITY.md](SECURITY.md) | سياسة الإبلاغ عن الثغرات + ملخص التعزيز الأمني |
| [CONTRIBUTING.md](CONTRIBUTING.md) | دليل المساهمة ومعايير الكود |
| [CHANGELOG.md](CHANGELOG.md) | سجل الإصدارات منذ 1.0 |
| [docs/EVALUATION.md](docs/EVALUATION.md) | **التقييم المقارن** مع Odoo/ERPNext/GNU Health وخارطة المعالجة |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | نشر Vercel / Docker / PostgreSQL |
| [docs/ANDROID.md](docs/ANDROID.md) | خطوات النشر على Google Play خطوة بخطوة |
| [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) | سياسة خصوصية جاهزة متوافقة مع متطلبات Play |

## 🐳 تشغيل بأمر واحد

```bash
docker compose up -d --build   # المنصة على http://localhost:3000
```

## 🚀 التشغيل السريع

```bash
# 1) الاستنساخ
git clone https://github.com/<YOUR-USERNAME>/ruba-pharmacy.git
cd ruba-pharmacy

# 2) التبعيات
bun install        # أو: npm install / pnpm install

# 3) البيئة
cp .env.example .env

# 4) قاعدة البيانات + بيانات تجريبية غنية
bun run db:push
bun run scripts/seed.ts

# 5) التشغيل
bun run dev        # ← http://localhost:3000
```

### 🔑 حسابات تجريبية (بيانات البذرة)

| الدور | المستخدم | كلمة المرور |
|---|---|---|
| مدير النظام | `admin` | `Admin@2026!` |
| صيدلي | `pharmacist` | `Pharm@2026!` |
| فني صيدلة | `tech1` | `Tech@2026!` |

> ⚠️ **للإنتاج**: غيّر كلمات المرور فوراً، واضبط `DATABASE_URL` على PostgreSQL، وشغّل خلف HTTPS.

## 🗂️ بنية المشروع

```
ruba-pharmacy/
├── .github/                    # CI، قوالب Issues/PR، Dependabot
├── prisma/schema.prisma        # 14 نموذجاً: User, Medicine, Batch, Sale, Supplier, PurchaseOrder, ...
├── scripts/seed.ts             # بيانات تجريبية عربية واقعية
├── docs/                       # ANDROID، DEPLOYMENT، PRIVACY_POLICY + لقطات
├── src/
│   ├── app/api/                # 28 مسار API: auth, sales, medicines, interactions/check, reports/profit, ...
│   ├── app/manifest.ts         # بيان PWA (تثبيت + Google Play)
│   ├── app/(dashboard)/        # الصفحات: POS، مخزون، مرضى، تقارير...
│   └── components/ruba/        # مكونات المنصة المخصصة
├── Dockerfile                  # صورة إنتاج متعددة المراحل (مستخدم غير جذر + healthcheck)
└── docker-compose.yml          # تشغيل فوري بوحدة بيانات دائمة
```

## 🗺️ خارطة الطريق

- [x] ✅ Docker + CI/CD + PWA + وثائق Google Play
- [x] ✅ دفعات LOT + صرف FEFO + إشعارات دفعات + اختبارات + وضع ليلي (v3.1)
- [x] ✅ موردون وأوامر شراء مع استلام ذري يولّد دفعات بالتكلفة الفعلية (v3.2)
- [x] ✅ تقارير أرباح بالتكلفة الفعلية + سجل تدقيق الدخول (v3.3)
- [x] ✅ ماسح باركود بالكاميرا + مؤشر دون اتصال (v3.4)
- [ ] طابور بيع مؤجل (أوفلاين كامل) + تعدد فروع
- [ ] باركود QR للفواتير (ZATCA)

<div align="center">

**ربي فارمسي** — منتج تطويره فريق **Ruba Pharmacy Team**

</div>

## 📄 الرخصة

MIT — استخدمه، عدّله، انشره بحرية. راجع [LICENSE](LICENSE).

</div>

---

<div align="center">

**Ruba Pharmacy Platform** — An Arabic-first, production-ready pharmacy management system.
POS with live drug-interaction checks · audited inventory · reorder forecasting · RTL UI.

Made with ❤️ for Arabic pharmacies

</div>
