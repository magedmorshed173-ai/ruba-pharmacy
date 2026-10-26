import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api-guard";
import {
  normalizePair,
  parseSeverity,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  EVIDENCE_LABEL,
  ONSET_LABEL,
  duplicateTherapyGroups,
  type InteractionSeverity,
} from "@/lib/clinical";

/**
 * POST /api/drugs/interactions — فاحص التفاعلات الدوائية للعميل (v4.0) — عام بلا جلسة
 * المدخل: { drugIds: string[] } من 2 إلى 8 بطاقات من دليل الدواء.
 * المحرك: نفس قاعدة التداخلات السريرية (Stockley/Lexicomp/FDA) المستخدمة
 * في البوابة السريرية عند نقطة البيع — مطابقة غير معتمدة على ترتيب الزوج.
 * يرصد أيضاً العلاج المكرر (نفس الفئة العلاجية ATC).
 */
export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    const ids: unknown = b?.drugIds;
    if (!Array.isArray(ids)) return fail("قائمة معرفات الأدوية مطلوبة");
    const unique = [...new Set(ids.map(String).filter(Boolean))];
    if (unique.length < 2) return fail("اختر دواءً اثنين على الأقل للفحص");
    if (unique.length > 8) return fail("الحد الأقصى 8 أدوية في الفحص الواحد");

    const drugs = await db.drug.findMany({
      where: { id: { in: unique }, isActive: true },
    });
    if (drugs.length !== unique.length)
      return fail("إحدى البطاقات المحددة غير موجودة في الدليل", 404);

    const generics = [...new Set(drugs.map((d) => d.scientificName.toLowerCase()))];

    // كل سجل تفاعل طرفاه ضمن المجموعة المختارة — بغضّ الاتجاه المخزَّن
    const rows = await db.drugInteraction.findMany({
      where: { isActive: true, genericA: { in: generics }, genericB: { in: generics } },
    });
    // فهرسة بالاتجاهين: التخزين بترتيب seed الخام، والمطابقة أبجدياً موحدة
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      byKey.set(`${r.genericA.toLowerCase()}|${r.genericB.toLowerCase()}`, r);
      byKey.set(`${r.genericB.toLowerCase()}|${r.genericA.toLowerCase()}`, r);
    }

    const hits: Record<string, unknown>[] = [];
    for (let i = 0; i < drugs.length; i++) {
      for (let j = i + 1; j < drugs.length; j++) {
        const a = drugs[i];
        const c = drugs[j];
        const ga = a.scientificName.toLowerCase();
        const gc = c.scientificName.toLowerCase();
        if (ga === gc) continue; // نفس المادة الفعالة — تُرصد كعلاج مكرر لا كتداخل
        const [x, y] = normalizePair(ga, gc);
        const row = byKey.get(`${x}|${y}`);
        if (!row) continue;
        const sev = parseSeverity(row.severity);
        hits.push({
          aId: a.id,
          bId: c.id,
          aTrade: a.tradeName,
          bTrade: c.tradeName,
          genericA: ga,
          genericB: gc,
          severity: sev,
          severityLabel: SEVERITY_LABEL[sev],
          description: row.description,
          mechanism: row.mechanism,
          clinicalEffect: row.clinicalEffect,
          management: row.management,
          evidenceLevel: row.evidenceLevel,
          evidenceLabel: row.evidenceLevel
            ? EVIDENCE_LABEL[row.evidenceLevel] ?? null
            : null,
          source: row.source,
          onset: row.onset,
          onsetLabel: row.onset ? ONSET_LABEL[row.onset] ?? null : null,
        });
      }
    }
    hits.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity as keyof typeof SEVERITY_RANK] -
        SEVERITY_RANK[a.severity as keyof typeof SEVERITY_RANK]
    );

    // العلاج المكرر: بطاقتان مختلفتان لنفس الفئة العلاجية الوظيفية (ATC)
    const duplicates = duplicateTherapyGroups(
      drugs.map((d) => ({ id: d.id, name: d.tradeName, atcClass: d.atcClass }))
    );

    const bySeverity = { contraindicated: 0, major: 0, moderate: 0, minor: 0 };
    for (const h of hits)
      bySeverity[h.severity as keyof typeof bySeverity]++;

    const highest: InteractionSeverity | null =
      hits.length > 0
        ? hits.reduce((acc, h) =>
            SEVERITY_RANK[h.severity as keyof typeof SEVERITY_RANK] >
            SEVERITY_RANK[acc.severity as keyof typeof SEVERITY_RANK]
              ? h
              : acc
          ).severity as InteractionSeverity
        : null;

    return ok({
      checked: drugs.length,
      results: hits,
      duplicates,
      summary: {
        pairs: hits.length,
        bySeverity,
        highest,
        highestLabel: highest ? SEVERITY_LABEL[highest] : null,
        blocking: highest === "contraindicated",
      },
    });
  } catch {
    return fail("تعذر فحص التفاعلات", 500);
  }
}
