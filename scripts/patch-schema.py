# -*- coding: utf-8 -*-
"""ترقيع prisma/schema.prisma — v3.7: السجل الوطني + الحجوزات + تتبع دفعات الصرف"""
import io, sys

PATH = "/home/z/my-project/prisma/schema.prisma"
src = io.open(PATH, encoding="utf-8").read()
orig = src

def must_replace(s, old, new, label):
    if old not in s:
        print(f"FAIL: anchor not found: {label}")
        sys.exit(1)
    return s.replace(old, new, 1)

# ── 1) Medicine: حقول السجل الوطني (قبل createdAt/updatedAt داخل Medicine —
#     نربط بالسطر الفريد maxDailyDose عبر البحث عن موقعه ثم نحقن بعده)
lines = src.split("\n")
out = []
in_medicine = False
inserted_registry_fields = False
for i, ln in enumerate(lines):
    out.append(ln)
    if ln.startswith("model Medicine "):
        in_medicine = True
    elif in_medicine and not inserted_registry_fields and ln.strip().startswith("maxDailyDose"):
        indent = "  "
        out.append(indent + "registrationNo       String? // رقم التسجيل في السجل الوطني للدواء")
        out.append(indent + 'registryStatus       String   @default("registered") // registered | suspended | banned | unregistered')
        out.append(indent + "maxRetailPrice       Int? // سقف السعر البيعي الوطني (هللات) — تجاوزه إنذار تسعيري")
        inserted_registry_fields = True

src = "\n".join(out)
if not inserted_registry_fields:
    print("FAIL: Medicine.maxDailyDose line not found"); sys.exit(1)

# ── 2) Medicine: علاقات جديدة
src = must_replace(
    src,
    "  prescriptionItems PrescriptionItem[]",
    "  prescriptionItems PrescriptionItem[]\n"
    "  regulatoryActions RegulatoryAction[]\n"
    "  reservations      StockReservation[]",
    "Medicine relations",
)

# ── 3) Batch: isRecalled + recalledAt (نحقن بعد isActive داخل Batch)
lines = src.split("\n")
out = []
in_batch = False
inserted_recall = False
for ln in lines:
    out.append(ln)
    if ln.startswith("model Batch "):
        in_batch = True
    elif in_batch and not inserted_recall and ln.strip() == "isActive   Boolean  @default(true)":
        out.append("  isRecalled Boolean   @default(false) // دفعة مسحوبة من التداول — محجوبة عن الصرف نهائياً")
        out.append("  recalledAt DateTime?")
        inserted_recall = True

src = "\n".join(out)
if not inserted_recall:
    print("FAIL: Batch.isActive line not found"); sys.exit(1)

# ── 4) SaleItem: علاقة batches
src = must_replace(
    src,
    "  costHalalas  Int      @default(0)",
    "  costHalalas  Int      @default(0)",
    "SaleItem costHalalas noop",  # noop to verify anchor exists
)

# SaleItem.batches relation — نحقن بعد سطر @@index الأخير داخل SaleItem
lines = src.split("\n")
out = []
in_saleitem = False
inserted_saleitem_rel = False
for ln in lines:
    out.append(ln)
    if ln.startswith("model SaleItem "):
        in_saleitem = True
    elif in_saleitem and not inserted_saleitem_rel and ln.strip() == "@@index([medicineId])":
        out.append("")
        out.append("  batches SaleItemBatch[]")
        inserted_saleitem_rel = True

src = "\n".join(out)
if not inserted_saleitem_rel:
    print("FAIL: SaleItem @@index([medicineId]) not found"); sys.exit(1)

# ── 5) النموذجان الجديدان بعد StockMovement مباشرة
anchor = """  @@index([medicineId, createdAt])
  @@index([createdAt])
}"""
new_models = """  @@index([medicineId, createdAt])
  @@index([createdAt])
}

// السجل الوطني للدواء — الطبقة التنظيمية فوق الطبقة السريرية
// (نمط SFDA/FDA: تسجيل، تعليق وقائي، حظر، سحب دفعات، سقف تسعيري)
model RegulatoryAction {
  id         String   @id @default(cuid())
  medicineId String
  medicine   Medicine @relation(fields: [medicineId], references: [id], onDelete: Cascade)
  actionType String // suspension | ban | recall | reinstatement | price_cap
  scope      String   @default("product") // product | lot
  lotNumber  String? // عند scope = lot
  reason     String // سبب القرار التنظيمي — إلزامي (التوثيق أساس اليقظة الدوائية)
  source     String   @default("SFDA") // الجهة المصدرة للقرار
  value      Int? // هللات — عند actionType = price_cap
  createdBy  String?
  isActive   Boolean  @default(true) // يُطفأ بإجراء لاحق (إعادة تسجيل/رفع القرار)
  createdAt  DateTime @default(now())

  @@index([medicineId, isActive])
  @@index([createdAt])
}

// حجز مخزون وقائي لوصفات قيد الطابور (نمط Allocated/Reserved Stock)
// يمنع نقطة البيع الحرة من بيع وحدات موعودة لوصفة بانتظار التحقق
model StockReservation {
  id                 String    @id @default(cuid())
  prescriptionId     String
  prescriptionItemId String
  medicineId         String
  medicine           Medicine  @relation(fields: [medicineId], references: [id])
  quantity           Int
  status             String    @default("active") // active | released | consumed
  createdAt          DateTime  @default(now())
  closedAt           DateTime? // لحظة الإفراج أو الاستهلاك

  @@index([medicineId, status])
  @@index([prescriptionId])
}

// تتبع دفعات الصرف — أي دفعة (LOT) صُرف منها في أي فاتورة
// أساس التتبع الأمامي عند سحب دفعة: من أخذ ماذا ومتى (نمط GS1 Track & Trace)
model SaleItemBatch {
  id         String   @id @default(cuid())
  saleItemId String
  saleItem   SaleItem @relation(fields: [saleItemId], references: [id], onDelete: Cascade)
  batchId    String
  lotNumber  String
  quantity   Int

  @@index([batchId])
  @@index([saleItemId])
}"""
src = must_replace(src, anchor, new_models, "StockMovement tail (append models)")

if src == orig:
    print("FAIL: no changes applied"); sys.exit(1)

io.open(PATH, "w", encoding="utf-8").write(src)
print("OK: schema patched")
