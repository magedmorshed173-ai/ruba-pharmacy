// ─────────────── حساب الأرباح النقي (v3.3) ───────────────
// الإيراد − التكلفة الفعلية للدفعات (FEFO snapshot) — أرقام هللات صحيحة.

export interface ProfitSaleItem {
  medicineName: string;
  quantity: number;
  subtotal: number; // هللات
  costHalalas: number; // هللات — 0 = مبيعات قديمة قبل v3.3 (تكلفة غير معلومة)
}

export interface ProfitSale {
  status: string;
  netAmount: number; // هللات
  saleDate: Date | string;
  items: ProfitSaleItem[];
}

export interface ProfitBreakdown {
  revenue: number; // صافي الإيراد (بعد الخصم)
  cogs: number; // تكلفة المبيعات المعروفة
  profit: number; // revenue − cogs
  marginPct: number; // 0-100
  knownCostItems: number; // بنود بتكلفة معلومة
  unknownCostItems: number; // بنود قديمة بلا لقطة تكلفة
}

export interface MedicineProfitRow {
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
}

/** تجميع ربح فترة كاملة — يتجاهل الفواتير الملغاة (void) */
export function aggregateProfit(sales: ProfitSale[]): ProfitBreakdown {
  let revenue = 0;
  let cogs = 0;
  let knownCostItems = 0;
  let unknownCostItems = 0;

  for (const s of sales) {
    if (s.status === "void") continue;
    revenue += s.netAmount;
    for (const it of s.items) {
      if (it.costHalalas > 0) {
        cogs += it.costHalalas;
        knownCostItems += 1;
      } else {
        unknownCostItems += 1;
      }
    }
  }

  const profit = revenue - cogs;
  const marginPct = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
  return { revenue, cogs, profit, marginPct, knownCostItems, unknownCostItems };
}

/** ربح لكل دواء — مرتب تنازلياً بالربح، بحد أقصى maxRows */
export function profitPerMedicine(sales: ProfitSale[], maxRows = 20): MedicineProfitRow[] {
  const map = new Map<string, MedicineProfitRow>();
  for (const s of sales) {
    if (s.status === "void") continue;
    for (const it of s.items) {
      const row =
        map.get(it.medicineName) ??
        ({ name: it.medicineName, quantity: 0, revenue: 0, cost: 0, profit: 0, marginPct: 0 } as MedicineProfitRow);
      row.quantity += it.quantity;
      row.revenue += it.subtotal;
      row.cost += it.costHalalas;
      map.set(it.medicineName, row);
    }
  }
  const rows = Array.from(map.values());
  for (const r of rows) {
    r.profit = r.revenue - r.cost;
    r.marginPct = r.revenue > 0 ? Math.round((r.profit / r.revenue) * 1000) / 10 : 0;
  }
  return rows.sort((a, b) => b.profit - a.profit).slice(0, maxRows);
}

/** سلسلة يومية (إيراد/ربح) لرسم بياني — الأيام بترتيب تصاعدي */
export function dailyProfitSeries(
  sales: ProfitSale[],
  days: number
): { date: string; revenue: number; profit: number }[] {
  const buckets = new Map<string, { revenue: number; profit: number }>();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 86400000);
    buckets.set(d.toISOString().slice(0, 10), { revenue: 0, profit: 0 });
  }
  for (const s of sales) {
    if (s.status === "void") continue;
    const key = new Date(s.saleDate).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    const cogs = s.items.reduce((a, x) => a + Math.max(0, x.costHalalas), 0);
    b.revenue += s.netAmount;
    b.profit += s.netAmount - cogs;
  }
  return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
}
