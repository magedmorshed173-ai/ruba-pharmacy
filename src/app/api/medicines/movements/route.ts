import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth } from "@/lib/api-guard";
import { toInt } from "@/lib/money";

// GET /api/medicines/movements?medicineId=&limit=50 — سجل تدقيق الحركات
export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const medicineId = sp.get("medicineId")?.trim() ?? "";
  const limit = Math.min(200, Math.max(10, toInt(sp.get("limit"), 60)));

  try {
    const movements = await db.stockMovement.findMany({
      where: medicineId ? { medicineId } : undefined,
      include: {
        medicine: { select: { name: true, barcode: true } },
        user: { select: { username: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return ok({ movements });
  } catch {
    return fail("تعذر جلب سجل الحركات", 500);
  }
}
