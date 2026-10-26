import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireRole } from "@/lib/api-guard";
import { toInt } from "@/lib/money";
import { drugMatchesQuery } from "@/lib/drug-guide";

/**
 * GET /api/drugs — دليل الدواء الوطني للعميل (v4.0) — عام بلا جلسة
 * ?q= بحث حر (تجاري/علمي لاتيني/علمي عربي/ATC/الشركة) بعد تطبيع عربي كامل
 * ?category= &form= &otc=1 &sort=name|price-asc|price-desc &page= &pageSize=
 * يعيد الواجهات (facets) والتوفر الحي للمنتجات المربوطة بالمخزون عبر الباركود.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";
    const category = sp.get("category")?.trim() ?? "";
    const form = sp.get("form")?.trim() ?? "";
    const otcOnly = sp.get("otc") === "1";
    const sort = sp.get("sort") ?? "name";
    const page = Math.max(1, toInt(sp.get("page"), 1));
    const pageSize = Math.min(60, Math.max(6, toInt(sp.get("pageSize"), 12)));

    // الكتالوج المرجعي صغير (مئات السجلات) — الترشيح في الذاكرة يتيح تطبيعاً
    // عربياً كاملاً (همزات/تاء مربوطة) لا يوفره LIKE في SQLite إطلاقاً.
    const all = await db.drug.findMany({ where: { isActive: true } });

    let items = all;
    if (category) items = items.filter((d) => d.category === category);
    if (form) items = items.filter((d) => d.form === form);
    if (otcOnly) items = items.filter((d) => !d.requiresRx);
    if (q) items = items.filter((d) => drugMatchesQuery(d, q));

    // الواجهات تُحسب من القائمة المرشّحة قبل الفرز — دليل تنقل دقيق للعميل
    const countBy = (key: "category" | "form") => {
      const m = new Map<string, number>();
      for (const d of items) {
        const v = String(d[key] ?? "").trim();
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return [...m.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));
    };
    const categories = countBy("category");
    const forms = countBy("form");

    if (sort === "price-asc") items.sort((a, b) => a.priceHalalas - b.priceHalalas);
    else if (sort === "price-desc") items.sort((a, b) => b.priceHalalas - a.priceHalalas);
    else items.sort((a, b) => a.tradeName.localeCompare(b.tradeName, "ar"));

    // التوفر الحي: منتجات المخزون المربوطة بباركود بطاقات الدليل
    const barcodes = Array.from(
      new Set(items.map((d) => d.linkedBarcode).filter((x): x is string => !!x))
    );
    const meds = barcodes.length
      ? await db.medicine.findMany({
          where: { barcode: { in: barcodes }, isActive: true },
          select: { barcode: true, quantity: true, sellingPrice: true },
        })
      : [];
    const medMap = new Map(meds.map((m) => [m.barcode, m]));

    const total = items.length;
    const results = items
      .slice((page - 1) * pageSize, page * pageSize)
      .map((d) => {
        const med = d.linkedBarcode ? medMap.get(d.linkedBarcode) : undefined;
        return {
          id: d.id,
          tradeName: d.tradeName,
          scientificName: d.scientificName,
          scientificNameAr: d.scientificNameAr,
          form: d.form,
          strength: d.strength,
          manufacturer: d.manufacturer,
          priceHalalas: d.priceHalalas,
          requiresRx: d.requiresRx,
          category: d.category,
          atcClass: d.atcClass,
          pregnancyCategory: d.pregnancyCategory,
          availability: med
            ? {
                linked: true,
                inStock: med.quantity > 0,
                quantity: med.quantity,
                storePriceHalalas: med.sellingPrice,
              }
            : { linked: false, inStock: false, quantity: 0, storePriceHalalas: null },
        };
      });

    return ok({ total, page, pageSize, categories, forms, results });
  } catch {
    return fail("تعذر جلب دليل الدواء", 500);
  }
}

/**
 * POST /api/drugs — إضافة بطاقة دواء للدليل (صيدلي فما فوق)
 * التحقق: الاسم التجاري فريد، والباركود المربوط (إن وُجد) منتج مخزون فعلي.
 */
export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("pharmacist");
  if (error) return error;

  try {
    const b = await request.json();
    const required = [
      "tradeName",
      "scientificName",
      "form",
      "strength",
      "manufacturer",
      "category",
      "indications",
      "dosageGuide",
      "sideEffects",
      "contraindications",
    ];
    for (const k of required) {
      if (!String(b?.[k] ?? "").trim()) return fail(`الحقل الإلزامي ناقص: ${k}`);
    }

    const tradeName = String(b.tradeName).trim();
    const price = toInt(b.priceHalalas, -1);
    if (price < 0) return fail("السعر غير صالح (هللات)");

    if (await db.drug.findUnique({ where: { tradeName } }))
      return fail("الاسم التجاري موجود مسبقاً في الدليل", 409);

    const linkedBarcode = String(b.linkedBarcode ?? "").trim() || null;
    if (linkedBarcode) {
      const med = await db.medicine.findUnique({ where: { barcode: linkedBarcode } });
      if (!med) return fail("باركود المنتج المخزن غير موجود", 400);
    }

    const drug = await db.drug.create({
      data: {
        tradeName,
        scientificName: String(b.scientificName).trim().toLowerCase(),
        scientificNameAr: String(b.scientificNameAr ?? "").trim() || null,
        atcCode: String(b.atcCode ?? "").trim() || null,
        atcClass: String(b.atcClass ?? "").trim() || null,
        form: String(b.form).trim(),
        strength: String(b.strength).trim(),
        manufacturer: String(b.manufacturer).trim(),
        country: String(b.country ?? "").trim() || null,
        priceHalalas: price,
        requiresRx: b.requiresRx !== false,
        category: String(b.category).trim(),
        indications: String(b.indications).trim(),
        dosageGuide: String(b.dosageGuide).trim(),
        sideEffects: String(b.sideEffects).trim(),
        contraindications: String(b.contraindications).trim(),
        pregnancyCategory: String(b.pregnancyCategory ?? "").trim() || null,
        storage: String(b.storage ?? "").trim() || null,
        linkedBarcode,
      },
    });
    return ok({ drug }, 201);
  } catch {
    return fail("تعذر إنشاء بطاقة الدواء", 500);
  }
}
