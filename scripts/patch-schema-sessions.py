#!/usr/bin/env python3
"""ترقيع المخطط: إضافة نموذج Session (جلسات قابلة للسحب) + علاقة sessions على User.
الملف به محارف bidi تحكمية تكسر أدوات التحرير النصية — الترقيع سطر-بسطر على مراسي فريدة."""
import io, sys

PATH = "prisma/schema.prisma"
src = io.open(PATH, encoding="utf-8").read().splitlines(keepends=False)

out, inserted_model, inserted_rel = [], False, False
i = 0
while i < len(src):
    line = src[i]
    stripped = line.strip()
    # مرساة علاقة User: أضف sessions بعد stockMovements داخل نموذج User
    if not inserted_rel and "stockMovements" in line and "StockMovement[]" in line:
        out.append(line)
        out.append("  sessions         Session[]")
        inserted_rel = True
        i += 1
        continue
    # مرساة النموذج: ألحق نموذج Session قبل أول @@index في SaleItemBatch؟ لا — في نهاية الملف
    out.append(line)
    i += 1

if not inserted_rel:
    sys.exit("FATAL: مرساة stockMovements غير موجودة")

MODEL = """
/// جلسة دخول قابلة للسحب (v3.9) — كل توكن JWT يقابله صف هنا؛
/// بلا صف أو صف مسحوب = التوكن ميت فوراً حتى لو لم تنته صلاحيته
model Session {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique // SHA-256 للتوكن — لا يُخزن التوكن الخام أبداً
  deviceHash String? // SHA-256 لـ User-Agent — ربط الجهاز: التوكن المسروق من متصفح آخر يُرفض
  ip         String?
  userAgent  String?
  revokedAt  DateTime?
  lastUsedAt DateTime  @default(now())
  createdAt  DateTime  @default(now())

  @@index([userId, revokedAt])
}
"""

if "model Session" in "\n".join(out):
    print("النموذج موجود مسبقاً — لا تكرار")
else:
    out.append(MODEL.rstrip("\n"))

io.open(PATH, "w", encoding="utf-8").write("\n".join(out) + "\n")
print("تم: علاقة sessions + نموذج Session")
