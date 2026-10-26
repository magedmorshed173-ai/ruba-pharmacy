import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, ok, requireAuth, requireRole } from "@/lib/api-guard";
import {
  computeSyncPlan,
  parseLicenseStatus,
  summarizeSyncPlan,
  type LicensedMedInput,
  type NationalEntryInput,
} from "@/lib/national-license";

/**
 * الطبقة الوطنية المرخصة — v4.1 (فجوة #1)
 *
 * GET /api/national-registry
 *   السجل المرخص الكامل + خطة المطابقة مع المخزون المحلي (بلا تنفيذ):
 *   كل دواء محلي مقابل ترخيصه الرسمي، حالة الحجب التلقائي، انحراف السعر
 *   عن السعر الرسمي المعتمد، وغير المدرج في السجل.
 *
 * POST /api/national-registry  (مدير فقط — نمط مصدر البيانات المرخص)
 *   body: { entries?: EntryPayload[] }
 *   - مع entries: استيراد/تحديث سجلات الترخيص (upsert برقم الترخيص) ثم
 *     تطبيق خطة المزامنة كاملة على المخزون.
 *   - بلا entries: إعادة تطبيق الخطة على السجل الموجود (تصحيح انحراف محلي).
 *
 * المزامنة تطبق «التصعيد بلا رجوع»:
 *   - مسحوب/معلق → registryStatus=suspended تلقائياً + إجراء تنظيمي موثق
 *     + إشعار (dedupeKey يمنع التكرار).
 *   - الترخيص المرخص لا يرفع حجباً محلياً آلياً (needsManualReview للمراجعة).
 *   - السعر الرسمي المعتمد يصبح سقف البيع ما لم يوجد سقف محلي أشد.
 */

interface EntryPayload {
  registrationNo: string;
  tradeName: string;
  genericName: string;
  dosage?: string | null;
  form?: string | null;
  manufacturer?: string | null;
  country?: string | null;
  atcCode?: string | null;
  barcode?: string | null;
  licenseStatus?: string | null;
  officialPrice?: number | null;
  withdrawnAt?: string | null;
  withdrawalReason?: string | null;
  source?: string | null;
}

const MED_SYNC_SELECT = {
  id: true,
  name: true,
  dosage: true,
  barcode: true,
  registrationNo: true,
  registryStatus: true,
  nationalDrugId: true,
  sellingPrice: true,
  maxRetailPrice: true,
} as const;

export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const [entries, meds] = await Promise.all([
      db.nationalDrug.findMany({
        orderBy: [{ licenseStatus: "desc" }, { tradeName: "asc" }],
        take: 500,
      }),
      db.medicine.findMany({
        where: { isActive: true },
        select: MED_SYNC_SELECT,
        orderBy: { name: "asc" },
      }),
    ]);

    const plan = computeSyncPlan(meds, entries);
    const summary = summarizeSyncPlan(plan);

    // عدد المنتجات المحلية المرتبطة بكل سجل مرخص
    const linkedCounts = new Map<string, number>();
    for (const m of meds) {
      if (m.nationalDrugId) {
        linkedCounts.set(m.nationalDrugId, (linkedCounts.get(m.nationalDrugId) ?? 0) + 1);
      }
    }

    return ok({
      entries: entries.map((e) => ({
        ...e,
        linkedMedicines: linkedCounts.get(e.id) ?? 0,
      })),
      matches: plan,
      summary,
    });
  } catch {
    return fail("تعذر جلب السجل الوطني المرخص", 500);
  }
}

export async function POST(request: NextRequest) {
  const { user, error } = await requireRole("admin");
  if (error) return error;

  try {
    const body = await request.json().catch(() => ({}));
    const payloadEntries: EntryPayload[] = Array.isArray(body?.entries)
      ? body.entries
      : [];

    // ── 1) التحقق من السجلات الواردة من المصدر ──
    const seenReg = new Set<string>();
    const seenBarcode = new Set<string>();
    const cleaned: Required<Pick<EntryPayload, "registrationNo" | "tradeName" | "genericName" | "licenseStatus" | "source">> &
      EntryPayload[] = [];
    for (const raw of payloadEntries) {
      const registrationNo = String(raw?.registrationNo ?? "").trim();
      const tradeName = String(raw?.tradeName ?? "").trim();
      const genericName = String(raw?.genericName ?? "").trim();
      if (!registrationNo || !tradeName || !genericName) {
        return fail("كل سجل مرخص يحتاج: رقم الترخيص + الاسم التجاري + المادة الفعالة");
      }
      if (seenReg.has(registrationNo)) {
        return fail(`رقم الترخيص مكرر داخل الدفعة: ${registrationNo}`);
      }
      seenReg.add(registrationNo);
      const barcode = raw?.barcode ? String(raw.barcode).trim() : null;
      if (barcode) {
        if (seenBarcode.has(barcode)) {
          return fail(`الباركود مرتبط بأكثر من ترخيص داخل الدفعة: ${barcode}`);
        }
        seenBarcode.add(barcode);
      }
      const officialPrice =
        raw?.officialPrice == null
          ? null
          : Number.isFinite(Number(raw.officialPrice)) && Number(raw.officialPrice) > 0
            ? Math.round(Number(raw.officialPrice))
            : null;
      cleaned.push({
        registrationNo,
        tradeName,
        genericName,
        dosage: raw?.dosage ? String(raw.dosage).trim() : null,
        form: raw?.form ? String(raw.form).trim() : null,
        manufacturer: raw?.manufacturer ? String(raw.manufacturer).trim() : null,
        country: raw?.country ? String(raw.country).trim() : null,
        atcCode: raw?.atcCode ? String(raw.atcCode).trim() : null,
        barcode,
        licenseStatus: parseLicenseStatus(String(raw?.licenseStatus ?? "licensed")),
        officialPrice,
        withdrawnAt: raw?.withdrawnAt ? String(raw.withdrawnAt) : null,
        withdrawalReason: raw?.withdrawalReason ? String(raw.withdrawalReason).trim() : null,
        source: raw?.source ? String(raw.source).trim() : "SFDA",
      });
    }

    const now = new Date();
    const shouldApply = Boolean(cleaned.length) || body?.apply === true;

    // ── 2) الاستيراد + التطبيق في معاملة ذرية واحدة ──
    const result = await db.$transaction(async (tx) => {
      let imported = 0;
      for (const e of cleaned) {
        const withdrawn = e.licenseStatus === "withdrawn";
        const licenseData = {
          tradeName: e.tradeName,
          genericName: e.genericName,
          dosage: e.dosage,
          form: e.form,
          manufacturer: e.manufacturer,
          country: e.country,
          atcCode: e.atcCode,
          barcode: e.barcode,
          licenseStatus: e.licenseStatus,
          officialPrice: e.officialPrice,
          priceEffectiveAt: e.officialPrice ? now : null,
          withdrawnAt: withdrawn
            ? e.withdrawnAt
              ? new Date(e.withdrawnAt)
              : now
            : null,
          withdrawalReason: withdrawn ? e.withdrawalReason : null,
          source: e.source,
          syncedAt: now,
        };
        await tx.nationalDrug.upsert({
          where: { registrationNo: e.registrationNo },
          create: { registrationNo: e.registrationNo, ...licenseData },
          update: licenseData,
        });
        imported++;
      }

      if (!shouldApply) {
        return {
          imported,
          applied: false,
          blocked: [] as { medicine: string; license: string }[],
          priceAligned: [] as { medicine: string; officialPrice: number }[],
          linked: 0,
          unmatched: [] as string[],
          manualReview: [] as string[],
          actions: 0,
        };
      }

      // ── 3) حساب الخطة على الحالة الحالية وتنفيذها ──
      const [entries, meds] = await Promise.all([
        tx.nationalDrug.findMany({ take: 500 }),
        tx.medicine.findMany({
          where: { isActive: true },
          select: MED_SYNC_SELECT,
        }),
      ]);

      const plan = computeSyncPlan(meds, entries);
      const blocked: { medicine: string; license: string }[] = [];
      const priceAligned: { medicine: string; officialPrice: number }[] = [];
      const unmatched: string[] = [];
      const manualReview: string[] = [];
      let linked = 0;
      let actions = 0;

      for (const item of plan) {
        if (!item.matched) {
          unmatched.push(item.name);
          continue;
        }
        const data: Record<string, unknown> = {};
        if (item.actions.linkNationalDrug) {
          data.nationalDrugId = item.actions.linkNationalDrug;
          linked++;
        }
        if (item.actions.setRegistrationNo) data.registrationNo = item.actions.setRegistrationNo;
        if (item.actions.setMaxRetailPrice !== undefined) {
          data.maxRetailPrice = item.actions.setMaxRetailPrice;
          priceAligned.push({
            medicine: item.name,
            officialPrice: item.actions.setMaxRetailPrice,
          });
        }

        if (item.actions.escalateToSuspended) {
          data.registryStatus = "suspended";
          blocked.push({
            medicine: item.name,
            license: item.licenseStatus ?? "suspended",
          });

          await tx.regulatoryAction.create({
            data: {
              medicineId: item.medicineId,
              actionType: "suspension",
              scope: "product",
              reason: `حجب تلقائي من مزامنة السجل المرخص: ترخيص ${item.registrationNo} (${item.licenseStatus === "withdrawn" ? "مسحوب من السوق" : "الترخيص معلق"}) — ${item.alerts.find((a) => a.blocking)?.message ?? ""}`,
              source: "SFDA-Sync",
              createdBy: user.id,
              isActive: true,
            },
          });
          await tx.notification.create({
            data: {
              kind: "warning",
              title: `حجب تلقائي: ${item.name}`,
              body: `ترخيص ${item.registrationNo} ${item.licenseStatus === "withdrawn" ? "مسحوب من السوق" : "معلق"} — الصرف محجوب بلا تجاوز حتى رفع القرار`,
              dedupeKey: `natsync:${item.registrationNo}:${item.licenseStatus}`,
            },
          });
          actions++;
        }

        if (item.actions.needsManualReview) manualReview.push(item.name);

        if (Object.keys(data).length > 0) {
          await tx.medicine.update({ where: { id: item.medicineId }, data });
          actions++;
        }
      }

      return {
        imported,
        applied: true,
        blocked,
        priceAligned,
        linked,
        unmatched,
        manualReview,
        actions,
      };
    });

    // ── 4) ملخص ما بعد المزامنة (حالة المصفوفة الفعلية) ──
    const [postMeds, postEntries] = await Promise.all([
      db.medicine.findMany({ where: { isActive: true }, select: MED_SYNC_SELECT }),
      db.nationalDrug.findMany({ take: 500 }),
    ]);
    const summary = summarizeSyncPlan(computeSyncPlan(postMeds, postEntries));

    return ok(
      {
        ...result,
        summary,
        message: result.applied
          ? `مزامنة السجل المرخص: ${result.blocked.length} حجب تلقائي، ${result.priceAligned.length} مواءمة تسعير، ${result.linked} ربط، ${result.unmatched.length} غير مدرج`
          : `استيراد السجل المرخص: ${result.imported} سجل (بلا تطبيق)`,
      },
      201
    );
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return fail("تعارض فريد في السجل المرخص (رقم ترخيص أو باركود مكرر)", 409);
    }
    return fail("تعذر تنفيذ مزامنة السجل المرخص", 500);
  }
}
