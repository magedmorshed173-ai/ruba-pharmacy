"use client";

/**
 * لوحة مراقبة السجل الوطني المرخص — ربي فارمسي v4.3 (فجوة #2)
 *
 * المرحلة الواجهية للطبقة الوطنية (v4.1): تحويل خدمة /api/national-registry
 * إلى لوحة رقابة يومية يرى فيها الصيدلي والمدير — لحظة بلحظة:
 *  1) منتجات الصيدلية مقابل سجل التراخيص: من مطابق، ومن غير مدرج، ومن حُجب
 *     تلقائياً (مسحوب/معلق — بلا تجاوز)، ومن يحتاج مراجعة يدوية.
 *  2) انحراف الأسعار عن السعر الرسمي المعتمد (مرجع التسعير الوطني).
 *  3) سجل التراخيص الرسمي نفسه (مصدر SFDA) مع عدد المنتجات المرتبطة بكل سجل.
 *  4) مدير فقط: إعادة تطبيق خطة المزامنة ذرياً، واستيراد سجلات من مصدر مرخص.
 *
 * القراءة متاحة لكل الأدوار (مراقبة تنظيمية) — الكتابة حصراً للمدير (نمط API).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtDate, fmtMoney, fmtNum } from "@/lib/api-client";
import type { AuthUser } from "@/lib/types";
import { REGISTRY_STATUS_LABEL } from "@/lib/registry";
import { LICENSE_STATUS_LABEL } from "@/lib/national-license";
import { StatCard, LoadingRows } from "./shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  BadgePercent,
  Ban,
  CloudDownload,
  FileWarning,
  Landmark,
  Link2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

// ─── أنواع استجابة GET /api/national-registry ───
interface RegistryEntry {
  id: string;
  registrationNo: string;
  tradeName: string;
  genericName: string;
  dosage?: string | null;
  form?: string | null;
  manufacturer?: string | null;
  country?: string | null;
  atcCode?: string | null;
  barcode?: string | null;
  licenseStatus: string;
  officialPrice?: number | null;
  withdrawnAt?: string | null;
  withdrawalReason?: string | null;
  source: string;
  syncedAt: string;
  linkedMedicines: number;
}

interface MatchAlert {
  kind: string;
  severity: string;
  message: string;
  blocking: boolean;
}

interface MatchItem {
  medicineId: string;
  name: string;
  matched: boolean;
  method: string | null;
  entryId?: string;
  registrationNo?: string;
  licenseStatus?: string;
  localStatus: string;
  effectiveStatus: string;
  actions: {
    linkNationalDrug?: string;
    setRegistrationNo?: string;
    setMaxRetailPrice?: number;
    escalateToSuspended?: boolean;
    needsManualReview?: boolean;
  };
  alerts: MatchAlert[];
}

interface PlanSummary {
  total: number;
  matched: number;
  unlisted: number;
  autoBlocked: number;
  priceAligned: number;
  linked: number;
  manualReview: number;
  blockingAlerts: number;
}

// ─── شارات الحالة ───
const LICENSE_BADGE: Record<string, { cls: string }> = {
  licensed:
    "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400",
  withdrawn:
    "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400",
  suspended:
    "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400",
  pending:
    "bg-sky-100 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-400",
};

const METHOD_LABEL: Record<string, string> = {
  link: "ربط مخزن",
  registration_no: "رقم الترخيص",
  barcode: "باركود GTIN",
  name_dosage: "الاسم + التركيز",
};

const EFFECTIVE_BADGE: Record<string, string> = {
  registered:
    "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-400",
  suspended:
    "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400",
  banned: "bg-rose-600 text-white hover:bg-rose-600",
  unregistered:
    "bg-muted text-muted-foreground hover:bg-muted",
};

function LicenseBadge({ status }: { status: string }) {
  const b = LICENSE_BADGE[status] ?? LICENSE_BADGE.pending;
  const label =
    LICENSE_STATUS_LABEL[status as keyof typeof LICENSE_STATUS_LABEL] ?? status;
  return (
    <Badge className={`font-medium ${b.cls}`}>{label}</Badge>
  );
}

function MethodBadge({ method }: { method: string | null }) {
  if (!method)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        بلا مطابقة
      </Badge>
    );
  return (
    <Badge variant="outline" className="font-medium">
      {METHOD_LABEL[method] ?? method}
    </Badge>
  );
}

function EffectiveBadge({ status }: { status: string }) {
  const label =
    REGISTRY_STATUS_LABEL[status as keyof typeof REGISTRY_STATUS_LABEL] ??
    status;
  return <Badge className={`font-medium ${EFFECTIVE_BADGE[status] ?? ""}`}>{label}</Badge>;
}

/** رقائق الإجراءات المعلقة في خطة المزامنة */
function ActionChips({ actions }: { actions: MatchItem["actions"] }) {
  const chips: { label: string; tone: string }[] = [];
  if (actions.linkNationalDrug)
    chips.push({ label: "ربط بالسجل", tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400" });
  if (actions.setRegistrationNo)
    chips.push({ label: "مواءمة رقم الترخيص", tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400" });
  if (actions.setMaxRetailPrice !== undefined)
    chips.push({ label: `سقف رسمي: ${fmtMoney(actions.setMaxRetailPrice)}`, tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400" });
  if (actions.escalateToSuspended)
    chips.push({ label: "حجب تلقائي", tone: "bg-rose-600 text-white" });
  if (actions.needsManualReview)
    chips.push({ label: "مراجعة يدوية", tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" });
  if (!chips.length)
    return <span className="text-xs text-muted-foreground">مطابق — بلا إجراءات</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <Badge key={c.label} className={`font-medium ${c.tone}`}>
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

// ─── المكوّن الرئيسي ───
export function NationalRegistryView({ user }: { user: AuthUser }) {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [planFilter, setPlanFilter] = useState<"all" | "blocking" | "unlisted" | "manual" | "price">("all");
  const [entryFilter, setEntryFilter] = useState<string>("all");
  const [planQuery, setPlanQuery] = useState("");
  const [entryQuery, setEntryQuery] = useState("");
  const [importText, setImportText] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const isAdmin = user.role === "admin";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await api<{
        entries: RegistryEntry[];
        matches: MatchItem[];
        summary: PlanSummary;
      }>("/api/national-registry");
      setEntries(r.entries ?? []);
      setMatches(r.matches ?? []);
      setSummary(r.summary ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر جلب السجل المرخص");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** إعادة تطبيق الخطة ذرياً (مدير فقط) */
  async function reapply() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/national-registry", {
        method: "POST",
        json: { apply: true },
      });
      setLastSync(r.message);
      toast.success(r.message);
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تطبيق المزامنة");
    } finally {
      setBusy(false);
    }
  }

  /** استيراد سجلات من مصدر مرخص (مدير فقط) — استيراد + تطبيق ذري */
  async function importEntries() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      toast.error("النص ليس JSON صالحاً");
      return;
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown[] })?.entries;
    if (!Array.isArray(list) || list.length === 0) {
      toast.error("أدخل مصفوفة سجلات مرخصة (entries)");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ message: string }>("/api/national-registry", {
        method: "POST",
        json: { entries: list },
      });
      setLastSync(r.message);
      toast.success(r.message);
      setImportText("");
      await load(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل استيراد السجل المرخص");
    } finally {
      setBusy(false);
    }
  }

  // ─── فلاتر خطة المطابقة ───
  const filteredMatches = useMemo(() => {
    const q = planQuery.trim();
    return matches.filter((m) => {
      if (planFilter === "blocking" && !(m.matched && m.alerts.some((a) => a.blocking))) return false;
      if (planFilter === "unlisted" && m.matched) return false;
      if (planFilter === "manual" && !m.actions.needsManualReview) return false;
      if (planFilter === "price" && !m.alerts.some((a) => a.kind === "price_cap")) return false;
      if (q && !m.name.includes(q) && !(m.registrationNo ?? "").includes(q)) return false;
      return true;
    });
  }, [matches, planFilter, planQuery]);

  // ─── فلاتر سجل التراخيص ───
  const filteredEntries = useMemo(() => {
    const q = entryQuery.trim();
    return entries.filter((e) => {
      if (entryFilter !== "all" && e.licenseStatus !== entryFilter) return false;
      if (
        q &&
        !e.tradeName.includes(q) &&
        !e.genericName.includes(q) &&
        !e.registrationNo.includes(q)
      )
        return false;
      return true;
    });
  }, [entries, entryFilter, entryQuery]);

  if (loading) return <LoadingRows rows={8} />;

  return (
    <div className="space-y-4">
      {/* الترويسة */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Landmark className="size-5 text-teal-600" />
            لوحة مراقبة السجل الوطني المرخص
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            مطابقة حية بين مخزون الصيدلية وسجل التراخيص الرسمي: حجب المسحوب
            تلقائياً بلا تجاوز، وسقف السعر الرسمي المعتمد، والغير مدرج — مع
            مزامنة ذرية للمدير.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard title="منتجات خاضعة للمطابقة" value={summary?.total ?? 0} icon={<Search className="size-5" />} tone="teal" />
        <StatCard title="مطابق بسجل مرخص" value={summary?.matched ?? 0} icon={<ShieldCheck className="size-5" />} tone="emerald" />
        <StatCard title="غير مدرج في السجل" value={summary?.unlisted ?? 0} icon={<FileWarning className="size-5" />} tone="amber" sub="راجع الترخيص ومصدر التوريد" />
        <StatCard title="حجب تلقائي حي" value={summary?.blockingAlerts ?? 0} icon={<Ban className="size-5" />} tone="rose" sub="مسحوب/معلق — بلا تجاوز" />
        <StatCard title="سقوف سعرية معلقة" value={summary?.priceAligned ?? 0} icon={<BadgePercent className="size-5" />} tone="sky" sub="بانتظار تطبيق المزامنة" />
        <StatCard title="مراجعة يدوية" value={summary?.manualReview ?? 0} icon={<UserCheck className="size-5" />} tone="violet" sub="مرخص وطنياً لكن محجوب محلياً" />
      </div>

      {lastSync && (
        <div className="rounded-lg border bg-teal-50 px-4 py-2 text-sm text-teal-800 dark:bg-teal-500/10 dark:text-teal-300">
          {lastSync}
        </div>
      )}

      <Tabs defaultValue="plan" dir="rtl">
        <TabsList>
          <TabsTrigger value="plan">خطة المطابقة ({matches.length})</TabsTrigger>
          <TabsTrigger value="entries">سجل التراخيص ({entries.length})</TabsTrigger>
          {isAdmin && <TabsTrigger value="sync">المزامنة</TabsTrigger>}
        </TabsList>

        {/* ── خطة المطابقة ── */}
        <TabsContent value="plan" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", `الكل (${matches.length})`],
                ["blocking", `حاجب (${matches.filter((m) => m.matched && m.alerts.some((a) => a.blocking)).length})`],
                ["unlisted", `غير مدرج (${summary?.unlisted ?? 0})`],
                ["manual", `مراجعة يدوية (${summary?.manualReview ?? 0})`],
                ["price", `انحراف سعري (${matches.filter((m) => m.alerts.some((a) => a.kind === "price_cap")).length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setPlanFilter(k)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  planFilter === k
                    ? "bg-teal-600 text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {label}
              </button>
            ))}
            <div className="relative ms-auto w-full sm:w-64">
              <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={planQuery}
                onChange={(e) => setPlanQuery(e.target.value)}
                placeholder="بحث بالاسم أو رقم الترخيص…"
                className="ps-8"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المنتج المحلي</TableHead>
                  <TableHead>المطابقة</TableHead>
                  <TableHead>رقم الترخيص</TableHead>
                  <TableHead>حالة الترخيص</TableHead>
                  <TableHead>الحالة الفعلية</TableHead>
                  <TableHead>إجراءات معلقة</TableHead>
                  <TableHead>التنبيهات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMatches.map((m) => {
                  const blocking = m.alerts.find((a) => a.blocking);
                  const priceAlert = m.alerts.find((a) => a.kind === "price_cap");
                  return (
                    <TableRow key={m.medicineId}>
                      <TableCell className="max-w-44 font-medium">{m.name}</TableCell>
                      <TableCell><MethodBadge method={m.method} /></TableCell>
                      <TableCell className="num text-xs">{m.registrationNo ?? "—"}</TableCell>
                      <TableCell>
                        {m.matched && m.licenseStatus ? (
                          <LicenseBadge status={m.licenseStatus} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell><EffectiveBadge status={m.effectiveStatus} /></TableCell>
                      <TableCell><ActionChips actions={m.actions} /></TableCell>
                      <TableCell className="max-w-72">
                        {m.alerts.length === 0 ? (
                          <span className="text-xs text-muted-foreground">لا شيء</span>
                        ) : (
                          <div className="space-y-1">
                            {(blocking ?? priceAlert ?? m.alerts[0]) && (
                              <p
                                className={`line-clamp-2 text-xs leading-relaxed ${
                                  blocking ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                                }`}
                              >
                                {blocking ? (
                                  <ShieldAlert className="me-1 inline size-3.5 align-[-2px]" />
                                ) : null}
                                {(blocking ?? priceAlert ?? m.alerts[0]).message}
                              </p>
                            )}
                            {m.alerts.length > 1 && (
                              <span className="text-[11px] text-muted-foreground">
                                + {m.alerts.length - 1} تنبيهاً آخر
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredMatches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      لا نتائج مطابقة للفلتر الحالي
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── سجل التراخيص ── */}
        <TabsContent value="entries" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", `الكل (${entries.length})`],
                ["licensed", `مرخص (${entries.filter((e) => e.licenseStatus === "licensed").length})`],
                ["withdrawn", `مسحوب (${entries.filter((e) => e.licenseStatus === "withdrawn").length})`],
                ["suspended", `معلق (${entries.filter((e) => e.licenseStatus === "suspended").length})`],
                ["pending", `قيد التقييم (${entries.filter((e) => e.licenseStatus === "pending").length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setEntryFilter(k)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  entryFilter === k
                    ? "bg-teal-600 text-white shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {label}
              </button>
            ))}
            <div className="relative ms-auto w-full sm:w-64">
              <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={entryQuery}
                onChange={(e) => setEntryQuery(e.target.value)}
                placeholder="بحث بالاسم التجاري أو المادة الفعالة…"
                className="ps-8"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الترخيص</TableHead>
                  <TableHead>الاسم التجاري</TableHead>
                  <TableHead>المادة الفعالة</TableHead>
                  <TableHead>التركيز</TableHead>
                  <TableHead>الشركة / المنشأ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>السعر الرسمي</TableHead>
                  <TableHead>مرتبط</TableHead>
                  <TableHead>آخر مزامنة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((e) => (
                  <TableRow key={e.id} className={e.licenseStatus === "withdrawn" ? "bg-rose-50/50 dark:bg-rose-500/5" : ""}>
                    <TableCell className="num text-xs font-medium">{e.registrationNo}</TableCell>
                    <TableCell className="font-medium">
                      {e.tradeName}
                      {e.licenseStatus === "withdrawn" && e.withdrawalReason && (
                        <p className="mt-0.5 max-w-56 text-[11px] leading-relaxed text-rose-600 dark:text-rose-400">
                          {e.withdrawalReason}
                          {e.withdrawnAt ? ` · ${fmtDate(e.withdrawnAt)}` : ""}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.genericName}</TableCell>
                    <TableCell className="text-xs">{e.dosage ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.manufacturer ?? "—"}
                      {e.country ? ` · ${e.country}` : ""}
                    </TableCell>
                    <TableCell><LicenseBadge status={e.licenseStatus} /></TableCell>
                    <TableCell className="num">
                      {e.officialPrice ? (
                        fmtMoney(e.officialPrice)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.linkedMedicines > 0 ? (
                        <Badge variant="outline" className="num gap-1 font-medium">
                          <Link2 className="size-3" />
                          {fmtNum(e.linkedMedicines)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(e.syncedAt)}</TableCell>
                  </TableRow>
                ))}
                {filteredEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                      لا سجلات مطابقة للفلتر الحالي
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── المزامنة (مدير فقط) ── */}
        {isAdmin && (
          <TabsContent value="sync" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="size-4 text-teal-600" />
                  إعادة تطبيق خطة المزامنة
                </CardTitle>
                <CardDescription>
                  يعيد حساب الخطة على الحالة الحالية ويطبقها ذرياً: ربط، مواءمة
                  أرقام الترخيص، اعتماد سقف السعر الرسمي (بلا خفض سقف أشد
                  قائم)، وحجب المسحوب/المعلق بإجراء تنظيمي موثق وإشعار.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={() => void reapply()} disabled={busy} className="w-full">
                  <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
                  تطبيق الآن
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  قاعدة الأمان الذهبية: التصعيد فقط آلياً — الترخيص الوطني
                  المرخص لا يرفع حجباً محلياً بقرار آلي، والرفع يبقى قراراً
                  يدوياً موثقاً من السجل التنظيمي.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CloudDownload className="size-4 text-teal-600" />
                  استيراد من مصدر مرخص
                </CardTitle>
                <CardDescription>
                  ألصق مصفوفة JSON من مزوّد بيانات الترخيص (نمط SFDA): رقم
                  الترخيص + الاسم التجاري + المادة الفعالة إلزامية، والباركود
                  GTIN يفعّل المطابقة المباشرة. الاستيراد والتطبيق في معاملة
                  واحدة ذرية.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={7}
                  dir="ltr"
                  className="font-mono text-xs"
                  placeholder={`[\n  {\n    "registrationNo": "H5-0032",\n    "tradeName": "زانتاك 150",\n    "genericName": "رانيتيدين",\n    "barcode": "6281001000032",\n    "licenseStatus": "withdrawn",\n    "officialPrice": 1100,\n    "source": "SFDA"\n  }\n]`}
                />
                <Button onClick={() => void importEntries()} disabled={busy || !importText.trim()} className="w-full">
                  <CloudDownload className="size-4" />
                  استيراد وتطبيق
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
