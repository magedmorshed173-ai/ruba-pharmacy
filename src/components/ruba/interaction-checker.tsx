"use client";

// فاحص التفاعلات الدوائية للعميل (v4.0) — نفس محرك البوابة السريرية
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  X,
  Plus,
  ShieldAlert,
  ShieldCheck,
  CopyPlus,
} from "lucide-react";
import {
  type DrugListItem,
  type InteractionHit,
  SeverityBadge,
} from "./drug-guide-shared";
import { normalizeArabic } from "@/lib/drug-guide";

interface CheckResponse {
  checked: number;
  results: InteractionHit[];
  duplicates: { atcClass: string; names: string[] }[];
  summary: {
    pairs: number;
    bySeverity: Record<string, number>;
    highest: string | null;
    highestLabel: string | null;
    blocking: boolean;
  };
}

export function InteractionChecker() {
  const [catalog, setCatalog] = useState<DrugListItem[] | null>(null);
  const [selected, setSelected] = useState<DrugListItem[]>([]);
  const [pickQuery, setPickQuery] = useState("");
  const [result, setResult] = useState<CheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // تحميل الكتالوج كاملاً للمنتقي (صفحات متتالية حتى الاكتمال)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const acc: DrugListItem[] = [];
        let page = 1;
        for (;;) {
          const r = await api<{ total: number; results: DrugListItem[] }>(
            `/api/drugs?page=${page}&pageSize=60`
          );
          acc.push(...r.results);
          if (acc.length >= r.total || page >= 6) break;
          page++;
        }
        if (!cancelled) setCatalog(acc);
      } catch {
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = useMemo(() => {
    if (!catalog) return [];
    const pickedIds = new Set(selected.map((s) => s.id));
    const q = normalizeArabic(pickQuery);
    return catalog
      .filter((d) => !pickedIds.has(d.id))
      .filter(
        (d) =>
          !q ||
          normalizeArabic(d.tradeName).includes(q) ||
          normalizeArabic(d.scientificNameAr ?? "").includes(q) ||
          normalizeArabic(d.scientificName).includes(q)
      )
      .slice(0, 8);
  }, [catalog, selected, pickQuery]);

  function add(d: DrugListItem) {
    if (selected.length >= 8) return;
    setSelected((s) => [...s, d]);
    setPickQuery("");
    setResult(null);
  }

  function remove(id: string) {
    setSelected((s) => s.filter((x) => x.id !== id));
    setResult(null);
  }

  async function check() {
    if (selected.length < 2) return;
    setChecking(true);
    setError(null);
    try {
      const r = await api<CheckResponse>("/api/drugs/interactions", {
        method: "POST",
        json: { drugIds: selected.map((s) => s.id) },
      });
      setResult(r);
    } catch (e) {
      setError((e as Error)?.message ?? "فشل الفحص");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
          <ShieldAlert className="size-4 text-teal-600" />
          اختر الأدوية (من 2 إلى 8) واعرف تداخلاتها فوراً
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          نفس القاعدة السريرية التي تحمي الصرف في الصيدلية — موثقة من Stockley وLexicomp وتحذيرات FDA.
        </p>

        {/* الأدوية المختارة */}
        <div className="mb-3 flex min-h-10 flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
          {selected.length === 0 && (
            <span className="px-1 text-xs text-muted-foreground">لم يُختر أي دواء بعد…</span>
          )}
          {selected.map((s) => (
            <Badge key={s.id} variant="outline" className="gap-1 bg-teal-600 text-white hover:bg-teal-600">
              {s.tradeName}
              <button
                onClick={() => remove(s.id)}
                aria-label={`إزالة ${s.tradeName}`}
                className="rounded-full p-0.5 hover:bg-white/20"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {selected.length > 0 && (
            <span className="ms-auto text-[10px] text-muted-foreground">{selected.length}/8</span>
          )}
        </div>

        {/* منتقي الأدوية */}
        <div className="relative">
          <Search className="absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)}
            placeholder="ابحث بالاسم التجاري أو العلمي لإضافة دواء…"
            className="ps-9"
            aria-label="بحث لإضافة دواء للفحص"
          />
          {pickQuery && (
            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-card shadow-lg">
              {candidates.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">لا نتائج مطابقة</p>
              )}
              {candidates.map((d) => (
                <button
                  key={d.id}
                  onClick={() => add(d)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                >
                  <Plus className="size-3.5 text-teal-600" />
                  <span className="font-bold">{d.tradeName}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.scientificNameAr ?? d.scientificName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={check}
            disabled={selected.length < 2 || checking}
            className="bg-teal-600 hover:bg-teal-700"
          >
            {checking ? "جارٍ الفحص…" : "افحص التفاعلات"}
          </Button>
          {selected.length < 2 && (
            <span className="text-xs text-muted-foreground">اختر اثنين على الأقل</span>
          )}
        </div>
        {error && <p className="mt-2 text-xs font-bold text-rose-600">{error}</p>}
      </div>

      {/* النتائج */}
      {checking && <Skeleton className="h-32 w-full" />}
      {result && (
        <div className="space-y-3">
          {/* الملخص */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
            {result.summary.pairs === 0 ? (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                <ShieldCheck className="size-3.5" /> لا تداخلات موثقة بين المختارات
              </Badge>
            ) : (
              <>
                <Badge
                  className={
                    result.summary.blocking
                      ? "gap-1 bg-rose-600 hover:bg-rose-600"
                      : "gap-1 bg-orange-500 hover:bg-orange-500"
                  }
                >
                  <ShieldAlert className="size-3.5" />
                  {result.summary.pairs} تداخلاً — الأخطر: {result.summary.highestLabel}
                </Badge>
                {(["contraindicated", "major", "moderate", "minor"] as const).map(
                  (sev) =>
                    result.summary.bySeverity[sev] > 0 && (
                      <Badge key={sev} variant="outline" className="text-[11px]">
                        {result.summary.bySeverity[sev]} × {sev === "contraindicated" ? "ممنوع" : sev === "major" ? "خطير" : sev === "moderate" ? "متوسط" : "بسيط"}
                      </Badge>
                    )
                )}
              </>
            )}
          </div>

          {/* العلاج المكرر */}
          {result.duplicates.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-200">
                <CopyPlus className="size-4" /> علاج مكرر — نفس الفئة العلاجية
              </p>
              {result.duplicates.map((dup, i) => (
                <p key={i} className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                  {dup.atcClass}: {dup.names.join(" + ")}
                </p>
              ))}
            </div>
          )}

          {/* بطاقات التداخلات */}
          {result.results.map((h, i) => (
            <div
              key={i}
              className={
                "rounded-xl border p-4 " +
                (h.severity === "contraindicated"
                  ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40"
                  : h.severity === "major"
                    ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40"
                    : "border bg-card")
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SeverityBadge severity={h.severity} label={h.severityLabel} />
                <span className="text-sm font-extrabold">
                  {h.aTrade} × {h.bTrade}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({h.genericA} + {h.genericB})
                </span>
                {h.source && (
                  <span className="ms-auto text-[10px] text-muted-foreground">
                    المصدر: {h.source}
                    {h.evidenceLabel ? ` · ${h.evidenceLabel}` : ""}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed">{h.description}</p>
              {h.mechanism && (
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  الآلية: {h.mechanism}
                </p>
              )}
              {h.clinicalEffect && (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  الأثر السريري: {h.clinicalEffect}
                </p>
              )}
              {h.management && (
                <p className="mt-1.5 rounded-lg bg-teal-600/10 px-2.5 py-1.5 text-xs font-medium leading-relaxed text-teal-800 dark:text-teal-200">
                  ما يجب فعله: {h.management}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="rounded-lg bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground">
        نتائج الفحص تثقيفية ولا تغني عن مراجعة الصيدلي — الصرف الفعلي يمرّ عبر البوابة السريرية في المنصة.
      </p>
    </div>
  );
}
