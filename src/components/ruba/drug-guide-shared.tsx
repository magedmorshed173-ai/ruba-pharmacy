"use client";

// عناصر مشتركة لدليل الدواء (v4.0) — أنواع البيانات وأنماط شدة التداخل
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface DrugAvailability {
  linked: boolean;
  inStock: boolean;
  quantity: number;
  storePriceHalalas: number | null;
  medicineName?: string;
  activeBatches?: number;
}

export interface DrugListItem {
  id: string;
  tradeName: string;
  scientificName: string;
  scientificNameAr: string | null;
  form: string;
  strength: string;
  manufacturer: string;
  priceHalalas: number;
  requiresRx: boolean;
  category: string;
  atcClass: string | null;
  pregnancyCategory: string | null;
  availability: DrugAvailability;
}

export interface DrugDetailResponse {
  drug: {
    id: string;
    tradeName: string;
    scientificName: string;
    scientificNameAr: string | null;
    atcCode: string | null;
    atcClass: string | null;
    form: string;
    strength: string;
    manufacturer: string;
    country: string | null;
    priceHalalas: number;
    requiresRx: boolean;
    category: string;
    indications: string;
    dosageGuide: string;
    sideEffects: string;
    contraindications: string;
    pregnancyCategory: string | null;
    storage: string | null;
    registrNo: string | null;
  };
  availability: DrugAvailability;
  alternatives: {
    id: string;
    tradeName: string;
    form: string;
    strength: string;
    manufacturer: string;
    priceHalalas: number;
    requiresRx: boolean;
    savingsHalalas: number;
    cheaperByPct: number;
    inStock: boolean;
  }[];
  interactions: {
    otherGeneric: string;
    otherTradeName: string | null;
    severity: string;
    severityLabel: string;
    description: string;
    mechanism: string | null;
    clinicalEffect: string | null;
    management: string | null;
    evidenceLabel: string | null;
    source: string | null;
    onsetLabel: string | null;
  }[];
}

export interface InteractionHit {
  aId: string;
  bId: string;
  aTrade: string;
  bTrade: string;
  genericA: string;
  genericB: string;
  severity: string;
  severityLabel: string;
  description: string;
  mechanism: string | null;
  clinicalEffect: string | null;
  management: string | null;
  evidenceLabel: string | null;
  source: string | null;
  onsetLabel: string | null;
}

/** أنماط شدة التداخل — دلالة لونية ثابتة عبر المنصة */
export const SEVERITY_STYLE: Record<string, string> = {
  contraindicated:
    "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800",
  major:
    "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800",
  moderate:
    "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800",
  minor:
    "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800",
};

export function SeverityBadge({ severity, label }: { severity: string; label: string }) {
  return (
    <Badge variant="outline" className={cn("border text-[11px] font-bold", SEVERITY_STYLE[severity] ?? "")}>
      {label}
    </Badge>
  );
}

export const PREGNANCY_LABEL: Record<string, string> = {
  A: "آمن بالتجربة",
  B: "آمن نسبياً",
  C: "حذرة — بموازنة النفع",
  D: "دليل ضرر — تجنّب",
  X: "ممنوع في الحمل",
};
