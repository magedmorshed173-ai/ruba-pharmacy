import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";

/** PATCH /api/branches/[id] — تعديل فرع أو إيقافه (مدير فقط) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireRole("admin");
  if (error) return error;
  const { id } = await params;

  try {
    const branch = await db.branch.findUnique({ where: { id } });
    if (!branch) return fail("الفرع غير موجود", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return fail("اسم الفرع مطلوب");
      const dupe = await db.branch.findFirst({ where: { name, id: { not: id } } });
      if (dupe) return fail("فرع آخر بهذا الاسم موجود", 409);
      data.name = name;
    }
    if (body.code !== undefined) {
      const code = String(body.code ?? "").trim() || null;
      if (code) {
        const dupe = await db.branch.findFirst({ where: { code, id: { not: id } } });
        if (dupe) return fail("رمز الفرع مستخدم لفرع آخر", 409);
      }
      data.code = code;
    }
    if (body.phone !== undefined) data.phone = String(body.phone ?? "").trim() || null;
    if (body.address !== undefined)
      data.address = String(body.address ?? "").trim() || null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.branch.update({ where: { id }, data });
    return ok({ branch: updated, message: "تم تحديث الفرع" });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return fail("اسم أو رمز مكرر", 409);
    return fail("تعذر تحديث الفرع", 500);
  }
}
