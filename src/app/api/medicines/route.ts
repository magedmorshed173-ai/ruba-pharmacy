import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import { sarToHalalas, toInt } from "@/lib/money";

// GET /api/medicines?q=&categoryId=&filter=low|expiring|expired&page=1&pageSize=20
export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const categoryId = sp.get("categoryId")?.trim() ?? "";
  const filter = sp.get("filter")?.trim() ?? "";
  const page = Math.max(1, toInt(sp.get("page"), 1));
  const pageSize = Math.min(100, Math.max(5, toInt(sp.get("pageSize"), 20)));

  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const in90 = new Date(now.getTime() + 90 * 24 * 3600 * 1000);

  const where: Record<string, unknown> = { isActive: true };
  if (q)
    where.OR = [
      { name: { contains: q } },
      { genericName: { contains: q } },
      { barcode: { contains: q } },
      { manufacturer: { contains: q } },
    ];
  if (categoryId) where.categoryId = categoryId;
  if (filter === "low") where.quantity = { lte: db.medicine.fields.minQuantity };
  if (filter === "expiring") where.expiryDate = { gt: now, lte: in90 };
  if (filter === "expired") where.expiryDate = { lte: now };
  if (filter === "active30") where.expiryDate = { gt: now, lte: in30 };

  try {
    const [total, medicines, reservedRows] = await Promise.all([
      db.medicine.count({ where }),
      db.medicine.findMany({
        where,
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ name: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // المحجوز لوصفات قيد الطابور — أساس «المتاح للبيع» الفعلي
      db.stockReservation.groupBy({
        by: ["medicineId"],
        where: { status: "active" },
        _sum: { quantity: true },
      }),
    ]);

    const reservedMap = new Map(reservedRows.map((r) => [r.medicineId, r._sum.quantity ?? 0]));

    const today = now.toISOString().slice(0, 10);
    const results = medicines.map((m) => {
      const reserved = reservedMap.get(m.id) ?? 0;
      return {
        ...m,
        isExpired: m.expiryDate.toISOString().slice(0, 10) <= today,
        daysUntilExpiry: Math.ceil(
          (m.expiryDate.getTime() - now.getTime()) / 86400000
        ),
        isLowStock: m.quantity <= m.minQuantity,
        reservedQty: reserved,
        availableQuantity: Math.max(0, m.quantity - reserved),
      };
    });

    return ok({ total, page, pageSize, results });
  } catch {
    return fail("تعذر جلب الأدوية", 500);
  }
}

// POST /api/medicines — إضافة دواء (صيدلي فما فوق)
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const genericName = String(body.genericName ?? "").trim();
    const barcode = String(body.barcode ?? "").trim();
    const categoryId = String(body.categoryId ?? "").trim();
    const expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;

    if (!name || !genericName || !barcode || !categoryId || !expiryDate)
      return fail("الحقول الأساسية ناقصة (الاسم، العلمي، الباركود، التصنيف، الصلاحية)");
    if (Number.isNaN(expiryDate.getTime())) return fail("تاريخ صلاحية غير صالح");

    const exists = await db.medicine.findUnique({ where: { barcode } });
    if (exists) return fail("الباركود مسجل مسبقاً لدواء آخر", 409);

    const category = await db.category.findUnique({ where: { id: categoryId } });
    if (!category) return fail("التصنيف غير موجود", 404);

    const medicine = await db.medicine.create({
      data: {
        name,
        genericName,
        barcode,
        categoryId,
        manufacturer: String(body.manufacturer ?? "").trim() || null,
        purchasePrice: sarToHalalas(body.purchasePrice ?? 0),
        sellingPrice: sarToHalalas(body.sellingPrice ?? 0),
        quantity: toInt(body.quantity, 0),
        minQuantity: toInt(body.minQuantity, 0),
        expiryDate,
        productionDate: body.productionDate ? new Date(body.productionDate) : null,
        dosage: String(body.dosage ?? "").trim() || null,
        requiresPrescription: Boolean(body.requiresPrescription),
      },
      include: { category: { select: { id: true, name: true } } },
    });

    // حركة تسوية افتتاحية إذا وُجد رصيد مبدئي
    if (medicine.quantity > 0) {
      await db.stockMovement.create({
        data: {
          medicineId: medicine.id,
          type: "adjust",
          delta: medicine.quantity,
          balanceAfter: medicine.quantity,
          reference: "رصيد افتتاحي",
          userId: user.id,
        },
      });
    }

    return ok({ medicine }, 201);
  } catch {
    return fail("تعذر إضافة الدواء", 500);
  }
}
