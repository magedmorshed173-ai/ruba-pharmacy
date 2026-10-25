/**
 * ترحيل لمرة واحدة: إنشاء دفعة (LOT) ابتدائية لكل دواء موجود
 * من نسخة ما قبل الدفعات — تُدفَن الكمية الحالية في دفعة "INIT"
 * بصلاحية الدواء المسجلة، دون أي فقدان بيانات.
 * التشغيل: bun scripts/migrate-batches.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const meds = await db.medicine.findMany({
    where: { quantity: { gt: 0 }, batches: { none: {} } },
    select: { id: true, quantity: true, expiryDate: true, purchasePrice: true },
  });

  console.log(`أدوية بحاجة لدفعة ابتدائية: ${meds.length}`);
  for (const m of meds) {
    await db.batch.create({
      data: {
        medicineId: m.id,
        lotNumber: "INIT",
        expiryDate: m.expiryDate,
        quantity: m.quantity,
        unitCost: m.purchasePrice,
        supplier: "رصيد افتتاحي",
      },
    });
  }
  const total = await db.batch.count();
  console.log(`✓ اكتمل — إجمالي الدفعات الآن: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
