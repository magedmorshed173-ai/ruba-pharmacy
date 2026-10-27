-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "netOfVat" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "vatTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "zatcaQr" TEXT;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sale_invoiceNumber_key" ON "Sale"("invoiceNumber");

