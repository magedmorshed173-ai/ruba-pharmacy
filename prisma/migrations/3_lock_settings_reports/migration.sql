-- v5.0 — إعدادات النظام الحية + لقطات التقارير المجدولة
-- 1) SystemSetting: إعدادات قفل النظام قابلة للضبط من لوحة الإعدادات (مع رجوع للبيئة)
-- 2) ReportSnapshot: لقطة يومية واحدة للمؤشرات — ينتجها Vercel Cron منتصف الليل

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'daily',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemSetting_updatedAt_idx" ON "SystemSetting"("updatedAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_createdAt_idx" ON "ReportSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_kind_periodStart_key" ON "ReportSnapshot"("kind", "periodStart");
