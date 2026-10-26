"use client";

// نشرة الدواء الكاملة (v4.0) — محتوى مرخص + توفر حي + بدائل موفرة + تداخلات
import { useEffect, useState } from "react";
import { api, fmtMoney } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Pill,
  PackageCheck,
  PackageX,
  AlertTriangle,
  ArrowRightLeft,
  Baby,
  Thermometer,
  FileText,
} from "lucide-react";
import {
  type DrugDetailResponse,
  SeverityBadge,
  PREGNANCY_LABEL,
} from "./drug-guide-shared";

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-teal-700 dark:text-teal-300">
        {icon}
        {title}
      </h4>
      <p className="text-sm leading-relaxed text-foreground/90">{children}</p>
    </section>
  );
}

export function DrugDetailDialog({
  drugId,
  open,
  onOpenChange,
}: {
  drugId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  // يُعاد تركيبه بـ key لكل دواء من الأب — الحالة تبدأ نظيفة،
  // والهيكل الافتراضي مشتق من غياب البيانات (بلا setState متزامن داخل effect)
  const [data, setData] = useState<DrugDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !drugId) return;
    let cancelled = false;
    api<DrugDetailResponse>(`/api/drugs/${drugId}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "تعذر جلب النشرة");
      });
    return () => {
      cancelled = true;
    };
  }, [open, drugId]);

  const d = data?.drug;
  const av = data?.availability;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {!data && !error && (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {error && (
          <p className="py-8 text-center text-sm font-bold text-rose-600">{error}</p>
        )}
        {d && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-start text-lg">
                <Pill className="size-5 text-teal-600" />
                {d.tradeName}
                {d.requiresRx ? (
                  <Badge variant="outline" className="bg-amber-100 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                    بوصفة طبية
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-emerald-100 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                    بدون وصفة
                  </Badge>
                )}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {d.scientificNameAr ?? d.scientificName}
                {d.scientificNameAr ? ` · ${d.scientificName}` : ""} · {d.form} · {d.strength} · {d.manufacturer}
                {d.country ? ` · ${d.country}` : ""}
              </p>
            </DialogHeader>

            {/* التوفر الحي والسعر */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
              {av?.linked ? (
                av.inStock ? (
                  <Badge className="gap-1 bg-teal-600 hover:bg-teal-600">
                    <PackageCheck className="size-3.5" /> متوفر في الصيدلية ({av.quantity} وحدة)
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
                    <PackageX className="size-3.5" /> غير متوفر حالياً — اطلب حجزاً
                  </Badge>
                )
              ) : (
                <Badge variant="outline">بطاقة مرجعية — غير مخزون لدينا</Badge>
              )}
              <span className="text-base font-extrabold">{fmtMoney(d.priceHalalas)} ر.س</span>
              {av?.linked && av.storePriceHalalas != null && av.storePriceHalalas !== d.priceHalalas && (
                <span className="text-xs text-muted-foreground">
                  سعر الصيدلية: {fmtMoney(av.storePriceHalalas)} ر.س
                </span>
              )}
              {d.registrNo && (
                <span className="ms-auto font-mono text-[10px] text-muted-foreground">
                  تسجيل: {d.registrNo}
                </span>
              )}
            </div>

            <div className="space-y-4">
              <Section title="دواعي الاستعمال" icon={<FileText className="size-4" />}>
                {d.indications}
              </Section>
              <Section title="طريقة الاستعمال" icon={<Thermometer className="size-4" />}>
                {d.dosageGuide}
              </Section>
              <Section title="الآثار الجانبية المحتملة" icon={<AlertTriangle className="size-4" />}>
                {d.sideEffects}
              </Section>
              <Section title="موانع الاستعمال" icon={<AlertTriangle className="size-4" />}>
                {d.contraindications}
              </Section>
              {d.pregnancyCategory && (
                <Section title="الحمل والرضاعة" icon={<Baby className="size-4" />}>
                  فئة الحمل ({d.pregnancyCategory}): {PREGNANCY_LABEL[d.pregnancyCategory] ?? "راجع الطبيب"}
                </Section>
              )}
              {d.storage && (
                <Section title="التخزين" icon={<Thermometer className="size-4" />}>
                  {d.storage}
                </Section>
              )}
              {d.atcClass && (
                <p className="text-[11px] text-muted-foreground">التصنيف العلاجي: {d.atcClass}</p>
              )}
            </div>

            {/* البدائل العلاجية */}
            {data!.alternatives.length > 0 && (
              <>
                <Separator />
                <section aria-label="البدائل العلاجية">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-teal-700 dark:text-teal-300">
                    <ArrowRightLeft className="size-4" />
                    بدائل بنفس المادة الفعالة — الأرخص أولاً
                  </h4>
                  <div className="space-y-2">
                    {data!.alternatives.map((a) => (
                      <div
                        key={a.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
                      >
                        <span className="font-bold">{a.tradeName}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.form} · {a.strength}
                        </span>
                        <span className="font-extrabold">{fmtMoney(a.priceHalalas)} ر.س</span>
                        {a.savingsHalalas > 0 ? (
                          <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">
                            أرخص بـ {fmtMoney(a.savingsHalalas)} ر.س ({Math.abs(a.cheaperByPct)}%)
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            أغلى بـ {fmtMoney(Math.abs(a.savingsHalalas))} ر.س
                          </Badge>
                        )}
                        {a.inStock && (
                          <Badge variant="outline" className="text-[10px] text-teal-700 dark:text-teal-300">
                            متوفر
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* التداخلات الموثقة */}
            {data!.interactions.length > 0 && (
              <>
                <Separator />
                <section aria-label="التداخلات الدوائية">
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-teal-700 dark:text-teal-300">
                    <AlertTriangle className="size-4" />
                    تداخلات دوائية موثقة لهذه المادة
                  </h4>
                  <div className="space-y-2">
                    {data!.interactions.map((it, idx) => (
                      <div key={idx} className="rounded-lg border bg-card p-3">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={it.severity} label={it.severityLabel} />
                          <span className="text-xs font-bold">
                            {it.otherTradeName ?? it.otherGeneric}
                          </span>
                          {it.onsetLabel && (
                            <span className="text-[10px] text-muted-foreground">· {it.onsetLabel}</span>
                          )}
                          {it.source && (
                            <span className="ms-auto text-[10px] text-muted-foreground">
                              المصدر: {it.source}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed">{it.description}</p>
                        {it.management && (
                          <p className="mt-1 text-[11px] leading-relaxed text-teal-700 dark:text-teal-300">
                            الإدارة: {it.management}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            <p className="rounded-lg bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground">
              هذا المحتوى تثقيفي ولا يغني عن استشارة الصيدلي أو الطبيب — الصرف يخضع للبوابة السريرية في المنصة.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
