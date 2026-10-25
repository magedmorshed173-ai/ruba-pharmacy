import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fail, requireRole } from "@/lib/api-guard";

// GET /api/backup — تصدير نسخة احتياطية JSON كاملة (مدير فقط)
export async function GET(request: NextRequest) {
  const { error } = await requireRole("admin");
  if (error) return error;

  try {
    const [users, categories, medicines, interactions, sales, patients, movements, notifications] =
      await Promise.all([
        db.user.findMany({ select: { id: true, username: true, fullName: true, role: true, isActive: true } }),
        db.category.findMany(),
        db.medicine.findMany(),
        db.drugInteraction.findMany(),
        db.sale.findMany({ include: { items: true } }),
        db.patient.findMany(),
        db.stockMovement.findMany(),
        db.notification.findMany(),
      ]);

    const payload = {
      meta: {
        product: "Ruba Pharmacy Platform",
        version: "3.0.0",
        exportedAt: new Date().toISOString(),
        counts: {
          users: users.length,
          categories: categories.length,
          medicines: medicines.length,
          sales: sales.length,
          patients: patients.length,
          movements: movements.length,
        },
      },
      data: { users, categories, medicines, interactions, sales, patients, movements, notifications },
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="ruba-backup-${stamp}.json"`,
      },
    });
  } catch {
    return fail("تعذر إنشاء النسخة الاحتياطية", 500);
  }
}
