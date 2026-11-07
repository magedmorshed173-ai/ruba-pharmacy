-- v5.6 — الجرد الفعلي
-- StockCount: جلسة عدّ فيزيائي بنقطة زمنية — تُجمَّد أرصدة النظام لكل دفعة
-- نشطة لحظة الفتح، وعند التطبيق تُصحَّح الأرصدة ذرياً (العدّ هو الحقيقة)
-- مع حركة مخزون ومساءلة كاملة، وثبات «المخصص ≤ المركزي» محفوظ.
-- StockCountItem: بند مجمّد بلا مفاتيح خارجية حية — حذف الدواء/الدفعة
-- لاحقاً لا يكسر التقرير التاريخي.

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "batchesTotal" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "countedItems" INTEGER NOT NULL DEFAULT 0,
    "matchedItems" INTEGER NOT NULL DEFAULT 0,
    "increasedItems" INTEGER NOT NULL DEFAULT 0,
    "decreasedItems" INTEGER NOT NULL DEFAULT 0,
    "skippedItems" INTEGER NOT NULL DEFAULT 0,
    "netQtyDelta" INTEGER NOT NULL DEFAULT 0,
    "netCostDelta" INTEGER NOT NULL DEFAULT 0,
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "medicineName" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "systemQty" INTEGER NOT NULL,
    "countedQty" INTEGER,
    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_number_key" ON "StockCount"("number");

-- CreateIndex
CREATE INDEX "StockCount_status_openedAt_idx" ON "StockCount"("status", "openedAt");

-- CreateIndex
CREATE INDEX "StockCount_openedAt_idx" ON "StockCount"("openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountItem_countId_batchId_key" ON "StockCountItem"("countId", "batchId");

-- CreateIndex
CREATE INDEX "StockCountItem_countId_idx" ON "StockCountItem"("countId");

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
