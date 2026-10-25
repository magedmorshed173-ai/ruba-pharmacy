import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { sarToHalalas, toInt } from "@/lib/money";

// PUT /api/medicines/:id — تعديل دواء (صيدلي فما فوق)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  const { id } = await params;
  try {
    const existing = await db.medicine.findUnique({ where: { id } });
    if (!existing) return fail("الدواء غير موجود", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.genericName !== undefined)
      data.genericName = String(body.genericName).trim();
    if (body.manufacturer !== undefined)
      data.manufacturer = String(body.manufacturer).trim() || null;
    if (body.categoryId !== undefined) data.categoryId = String(body.categoryId);
    if (body.purchasePrice !== undefined)
      data.purchasePrice = sarToHalalas(body.purchasePrice);
    if (body.sellingPrice !== undefined)
      data.sellingPrice = sarToHalalas(body.sellingPrice);
    if (body.minQuantity !== undefined) data.minQuantity = toInt(body.minQuantity);
    if (body.expiryDate !== undefined) {
      const d = new Date(body.expiryDate);
      if (Number.isNaN(d.getTime())) return fail("تاريخ صلاحية غير صالح");
      data.expiryDate = d;
    }
    if (body.productionDate !== undefined)
      data.productionDate = body.productionDate ? new Date(body.productionDate) : null;
    if (body.dosage !== undefined) data.dosage = String(body.dosage).trim() || null;
    if (body.requiresPrescription !== undefined)
      data.requiresPrescription = Boolean(body.requiresPrescription);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    // الباركود لا يُعدَّل إن كان مستخدماً لدواء آخر
    if (body.barcode !== undefined) {
      const bc = String(body.barcode).trim();
      if (!bc) return fail("الباركود مطلوب");
      const clash = await db.medicine.findFirst({
        where: { barcode: bc, id: { not: id } },
      });
      if (clash) return fail("الباركود مسجل مسبقاً لدواء آخر", 409);
      data.barcode = bc;
    }

    const medicine = await db.medicine.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    return ok({ medicine });
  } catch {
    return fail("تعذر تعديل الدواء", 500);
  }
}

// DELETE /api/medicines/:id — حذف منطقي (صيدلي فما فوق)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("pharmacist");
  if (error) return error;

  const { id } = await params;
  try {
    const used = await db.saleItem.findFirst({ where: { medicineId: id } });
    if (used) {
      await db.medicine.update({ where: { id }, data: { isActive: false } });
      return ok({ message: "الدواء مرتبط بمبيعات سابقة — تم أرشفته بدل الحذف", archived: true });
    }
    await db.medicine.delete({ where: { id } });
    return ok({ message: "تم حذف الدواء", deleted: true });
  } catch {
    return fail("تعذر حذف الدواء", 500);
  }
}
