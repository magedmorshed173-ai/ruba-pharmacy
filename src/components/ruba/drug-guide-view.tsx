"use client";

// دليل الدواء الوطني (v4.0) — تبويب العميل: كتالوج بحث فوري + فاحص تفاعلات
import { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtMoney } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Pill,
  ChevronRight,
  ChevronLeft,
  PackageCheck,
  PackageX,
  Bookmark,
} from "lucide-react";
import { type DrugListItem, type DrugDetailResponse } from "./drug-guide-shared";
import { DrugDetailDialog } from "./drug-detail-dialog";
import { InteractionChecker } from "./interaction-checker";

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  categories: { name: string; count: number }[];
  forms: { name: string; count: number }[];
  results: DrugListItem[];
}

const PAGE_SIZE = 12;

export function DrugGuideView() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [otcOnly, setOtcOnly] = useState(false);
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // بحث فوري مؤجل 300 مللي ثانية — أداة حديثة بلا مكتبات خارجية
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQ(input);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
    });
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (otcOnly) params.set("otc", "1");
    api<ListResponse>(`/api/drugs?${params.toString()}`)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, category, otcOnly, sort, page]);

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1),
    [data]
  );

  function openDetail(id: string) {
    setDetailId(id);
    setDetailOpen(true);
  }

  return (
    <Tabs defaultValue="catalog" className="space-y-4">
      <TabsList className="grid w-full max-w-md grid-cols-2">
        <TabsTrigger value="catalog" className="gap-1.5">
          <Pill className="size-4" /> كتالوج الدواء
        </TabsTrigger>
        <TabsTrigger value="checker" className="gap-1.5">
          فاحص التفاعلات
        </TabsTrigger>
      </TabsList>

      {/* ─── الكتالوج ─── */}
      <TabsContent value="catalog" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ابحث بالاسم التجاري أو العلمي… (مثال: أدول، باراسيتامول، warfarin)"
              className="ps-9"
              aria-label="بحث في دليل الدواء"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="otc-switch"
                checked={otcOnly}
                onCheckedChange={(v) => {
                  setOtcOnly(v);
                  setPage(1);
                }}
              />
              <Label htmlFor="otc-switch" className="cursor-pointer text-xs">
                بدون وصفة فقط
              </Label>
            </div>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-36" aria-label="ترتيب النتائج">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">الاسم أبجدياً</SelectItem>
                <SelectItem value="price-asc">الأرخص أولاً</SelectItem>
                <SelectItem value="price-desc">الأغلى أولاً</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* فئات علاجية */}
        {data && data.categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                setCategory("");
                setPage(1);
              }}
              className={
                "rounded-full border px-3 py-1 text-xs font-bold transition " +
                (category === ""
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "bg-card hover:bg-accent")
              }
            >
              الكل ({data.total})
            </button>
            {data.categories.map((c) => (
              <button
                key={c.name}
                onClick={() => {
                  setCategory(c.name === category ? "" : c.name);
                  setPage(1);
                }}
                className={
                  "rounded-full border px-3 py-1 text-xs font-bold transition " +
                  (category === c.name
                    ? "border-teal-600 bg-teal-600 text-white"
                    : "bg-card hover:bg-accent")
                }
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        )}

        {/* الشبكة */}
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : !data || data.results.length === 0 ? (
          <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            لا توجد نتائج مطابقة — جرّب كلمة أبسط أو أزل المرشحات.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.results.map((d) => (
              <button
                key={d.id}
                onClick={() => openDetail(d.id)}
                className="group rounded-xl border bg-card p-4 text-start shadow-sm transition hover:border-teal-500 hover:shadow-md"
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-extrabold group-hover:text-teal-700 dark:group-hover:text-teal-300">
                    {d.tradeName}
                  </h3>
                  {d.requiresRx ? (
                    <Badge variant="outline" className="shrink-0 bg-amber-100 text-[9px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                      وصفة
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 bg-emerald-100 text-[9px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                      OTC
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.scientificNameAr ?? d.scientificName}
                  {d.scientificNameAr ? ` · ${d.scientificName}` : ""}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {d.form} · {d.strength} · {d.manufacturer}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-base font-extrabold">{fmtMoney(d.priceHalalas)} ر.س</span>
                  {d.availability.linked ? (
                    d.availability.inStock ? (
                      <Badge className="gap-1 bg-teal-600 text-[10px] hover:bg-teal-600">
                        <PackageCheck className="size-3" /> متوفر ({d.availability.quantity})
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-rose-300 bg-rose-100 text-[10px] text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
                        <PackageX className="size-3" /> نفد
                      </Badge>
                    )
                  ) : (
                    <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                      <Bookmark className="size-3" /> مرجعي
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ترقيم الصفحات */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight className="size-4" /> السابق
            </Button>
            <span className="text-xs font-bold">
              صفحة {page} من {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              التالي <ChevronLeft className="size-4" />
            </Button>
          </div>
        )}
      </TabsContent>

      {/* ─── الفاحص ─── */}
      <TabsContent value="checker">
        <InteractionChecker />
      </TabsContent>

      <DrugDetailDialog
        key={detailId ?? "none"}
        drugId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </Tabs>
  );
}

// type import used for detail prefetch typing safety
export type { DrugDetailResponse };
