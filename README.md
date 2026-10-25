<div dir="rtl" align="center">

# 💊 ربي فارمسي — نظام إدارة الصيدليات العربي المتكامل

**منصة ويب حديثة «بمستوى الكبار» لإدارة الصيدلية بالكامل: نقطة بيع ذكية، مخزون، مرضى، تداخلات دوائية، تقارير — بواجهة عربية RTL أنيقة.**

![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![Tailwind CSS 4](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
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
- **فاحص تداخلات دوائية حي**: يفحص سلة↔سلة وسلة↔أمراض المريض المزمنة قبل إتمام البيع
- خصومات، طرق دفع متعددة (نقدي/شبكة)، فاتورة رقمية بعد البيع
- **Idempotency**: مرجع فريد لكل عملية يمنع البيع المكرر عند ضعف الشبكة
- إلغاء واسترجاع كامل للفواتير مع إعادة الكميات تلقائياً

### 📦 المخزون والتنبؤ
- إدارة كاملة للأدوية (28 دواء عربي مُحمَّل جاهزاً) مع التصنيفات
- سجل تدقيق **StockMovement** لكل حركة إدخال/إخراج — لا رقم يختفي
- **تنبؤ إعادة الطلب** الذكي بناءً على معدل الاستهلاك اليومي ومهلة التوريد
- تنبيهات انخفاض المخزون ونفاد الأصناف عبر مركز إشعارات بمفتاح `dedupeKey` فريد

### 👥 المرضى والرعاية
- ملفات مرضى مع الأمراض المزمنة والحساسية
- فحص التداخلات مرتبط بسجل المريض المزمن — سلامة دوائية حقيقية

### 📊 التقارير والذكاء
- لوحة تحكم بمؤشرات KPI حية: مبيعات اليوم، إيراد الشهر، قيمة المخزون، تنبيهات
- رسوم بيانية (Recharts): حركة الإيرادات اليومية + توزيع التصنيفات
- تقارير مبيعات بفلاتر تاريخ وحالة، **تصدير CSV** بترميز UTF-8-BOM يفتح مباشرة في Excel العربي

### 🔐 الأمان — مراجعة هندسية حقيقية
هذه النسخة نتجت عن **مراجعة أمنية شاملة** أصلحت أبرز ثغرات الأنظمة المشابهة:

| الثغرة | الإصلاح |
|---|---|
| فحص الدور داخل الـ handler بعد اجتياز DRF (يتجاوزه الفني) | فحص دور مركزي في **كل** endpoint قبل التنفيذ — `403` للفني على التعبئة |
| تضارب أنواع الكميات (Decimal مقابل Int) | النقود بالهللات (Integer) — دقة مالية مطلقة، بلا أخطاء فاصلة عائمة |
| دمج الإشعارات عبر `title__contains` الهش | مفتاح `dedupeKey` فريد لكل تنبيه |
| فحص التداخلات غير مربوط بنقطة البيع | فحص إلزامي في سلة البيع قبل الاعتماد |
| كلمات مرور؟ | `bcrypt` + JWT (jose) في كوكي `httpOnly` — لا توكن في localStorage |

## 🧱 التقنيات

- **Next.js 16** (App Router) + **TypeScript 5**
- **Prisma 6** + SQLite (جاهز للترقية إلى PostgreSQL بتغيير واحد)
- **Tailwind CSS 4** + **shadcn/ui** + **Recharts**
- خط **Tajawal** العربي، ثيم طبي Teal، دعم RTL كامل
- اختبار تحقّق كامل عبر متصفح آلي (دخول ← بيع ← تداخل دوائي ← تقارير ← جوال 390px)

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
├── prisma/schema.prisma        # 9 نماذج: User, Medicine, Sale, Patient, ...
├── scripts/seed.ts             # بيانات تجريبية عربية واقعية
├── src/
│   ├── app/api/                # 11 مسار API: auth, sales, medicines, ...
│   ├── app/(dashboard)/        # الصفحات: POS, مخزون, مرضى, تقارير...
│   └── components/ruba/        # مكونات المنصة المخصصة
└── docs/screenshots/           # لقطات الواجهة
```

## 🗺️ خارطة الطريق

- [ ] PostgreSQL + Docker Compose
- [ ] إشعارات WhatsApp/SMS للطلبات الجاهزة
- [ ] باركود QR للفواتير (ZATCA)
- [ ] تطبيق جوال (React Native يشارك نفس الـ API)
- [ ] تعدد الفروع ومزامنة المخزون

## 📄 الرخصة

MIT — استخدمه، عدّله، انشره بحرية. راجع [LICENSE](LICENSE).

</div>

---

<div align="center">

**Ruba Pharmacy Platform** — An Arabic-first, production-ready pharmacy management system.
POS with live drug-interaction checks · audited inventory · reorder forecasting · RTL UI.

Made with ❤️ for Arabic pharmacies

</div>
