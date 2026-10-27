import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";

/** PATCH /api/insurance/providers/[id] — تعديل شركة تأمين أو إيقافها (مدير فقط) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("admin");
  if (error) return error;
  const { id } = await params;

  try {
    const provider = await db.insuranceProvider.findUnique({ where: { id } });
    if (!provider) return fail("شركة التأمين غير موجودة", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return fail("اسم شركة التأمين مطلوب");
      const dupe = await db.insuranceProvider.findFirst({
        where: { name, id: { not: id } },
      });
      if (dupe) return fail("شركة أخرى بهذا الاسم موجودة", 409);
      data.name = name;
    }
    if (body.code !== undefined) {
      const code = String(body.code ?? "").trim() || null;
      if (code) {
        const dupe = await db.insuranceProvider.findFirst({
          where: { code, id: { not: id } },
        });
        if (dupe) return fail("رمز التعامل مستخدم لشركة أخرى", 409);
      }
      data.code = code;
    }
    if (body.phone !== undefined) data.phone = String(body.phone ?? "").trim() || null;
    if (body.email !== undefined) data.email = String(body.email ?? "").trim() || null;
    if (body.notes !== undefined) data.notes = String(body.notes ?? "").trim() || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.insuranceProvider.update({ where: { id }, data });
    return ok({ provider: updated, message: "تم تحديث شركة التأمين" });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return fail("اسم أو رمز مكرر", 409);
    return fail("تعذر تحديث شركة التأمين", 500);
  }
}
