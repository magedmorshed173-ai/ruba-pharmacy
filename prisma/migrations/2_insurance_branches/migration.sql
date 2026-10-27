-- v4.6 (P2) — التأمين الطبي + تعدد الفروع
-- 1) جداول جديدة: Branch, InsuranceProvider, PatientInsurancePolicy
-- 2) أعمدة تأمين وفرع على Sale وربط فرع على User
-- 3) فهارس الاستعلام: مبيعات الفرع، حالة المطالبة، شركات التأمين

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "branchId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "claimStatus" TEXT,
ADD COLUMN     "claimUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "insurancePolicyId" TEXT,
ADD COLUMN     "insuranceProviderId" TEXT,
ADD COLUMN     "insurerAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "patientAmount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientInsurancePolicy" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "holderName" TEXT,
    "coverageBps" INTEGER NOT NULL DEFAULT 7000,
    "copayFixed" INTEGER,
    "expiryDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientInsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_isActive_idx" ON "Branch"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceProvider_name_key" ON "InsuranceProvider"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceProvider_code_key" ON "InsuranceProvider"("code");

-- CreateIndex
CREATE INDEX "InsuranceProvider_isActive_idx" ON "InsuranceProvider"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PatientInsurancePolicy_providerId_policyNumber_key" ON "PatientInsurancePolicy"("providerId", "policyNumber");

-- CreateIndex
CREATE INDEX "PatientInsurancePolicy_patientId_isActive_idx" ON "PatientInsurancePolicy"("patientId", "isActive");

-- CreateIndex
CREATE INDEX "PatientInsurancePolicy_providerId_idx" ON "PatientInsurancePolicy"("providerId");

-- CreateIndex
CREATE INDEX "Sale_branchId_saleDate_idx" ON "Sale"("branchId", "saleDate");

-- CreateIndex
CREATE INDEX "Sale_claimStatus_idx" ON "Sale"("claimStatus");

-- CreateIndex
CREATE INDEX "Sale_insuranceProviderId_idx" ON "Sale"("insuranceProviderId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_insuranceProviderId_fkey" FOREIGN KEY ("insuranceProviderId") REFERENCES "InsuranceProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_insurancePolicyId_fkey" FOREIGN KEY ("insurancePolicyId") REFERENCES "PatientInsurancePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInsurancePolicy" ADD CONSTRAINT "PatientInsurancePolicy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInsurancePolicy" ADD CONSTRAINT "PatientInsurancePolicy_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "InsuranceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
