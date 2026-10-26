#!/usr/bin/env python3
"""ترقيع المخطط (v4.0): إضافة نموذج Drug — دليل الدواء الوطني المرخص للعميل.
الملف به محارف bidi تحكمية تكسر أدوات التحرير النصية — الترقيع سطر-بسطر على مراسي فريدة."""
import io, sys

PATH = "prisma/schema.prisma"
src = io.open(PATH, encoding="utf-8").read()

MODEL = '''
/// دليل الدواء الوطني (v4.0) — المحتوى المرخص المرجعي الذي يراه العميل،
/// منفصل عن المخزون التشغيلي (Medicine) ومرتبط باختياري عبر باركود المنتج
/// المخزّن لتفعيل «التوفر الحي» و«السعر الفعلي» في نشرة الدواء.
model Drug {
  id                String   @id @default(cuid())
  tradeName         String   @unique
  scientificName    String // المادة الفعالة (لاتيني) — مفتاح التفاعلات والبدائل
  scientificNameAr  String? // المادة الفعالة بالعربية — لبحث العميل بالعربية
  atcCode           String?
  atcClass          String?
  form              String // الشكل الجرعي (أقراص، شراب، بخاخ…)
  strength          String // التركيز (500 ملغ…)
  manufacturer      String
  country           String?
  priceHalalas      Int // السعر الرسمي المرخص (هللات — معيار النقود بالمشروع)
  requiresRx        Boolean  @default(true) // بيع بموجب وصفة طبية
  category          String // الفئة العلاجية العربية
  indications       String // دواعي الاستعمال
  dosageGuide       String // طريقة الاستعمال والجرعة
  sideEffects       String // الآثار الجانبية المحتملة
  contraindications String // موانع الاستعمال
  pregnancyCategory String? // فئة الحمل (FDA): A B C D X
  storage           String?
  registrNo         String?  @unique // رقم التسجيل بالسجل الوطني للدواء
  linkedBarcode     String? // باركود المنتج المخزّن (Medicine.barcode) — التوفر الحي
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([scientificName])
  @@index([category])
  @@index([isActive, tradeName])
}
'''

if "model Drug {" in src:
    print("نموذج Drug موجود مسبقاً — لا تكرار")
else:
    if not src.endswith("\n"):
        src += "\n"
    io.open(PATH, "w", encoding="utf-8").write(src + MODEL.lstrip("\n"))
    print("تم: نموذج Drug مُلحق بنهاية المخطط")
