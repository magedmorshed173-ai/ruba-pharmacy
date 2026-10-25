"use client";

// عميل API موحّد للواجهة — يعالج الأخطاء ويعيد JSON مباشرة
export async function api<T = unknown>(
  path: string,
  options?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json, ...rest } = options ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });

  const ct = res.headers.get("content-type") ?? "";
  const payload = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `خطأ ${res.status}`;
    const err = new Error(message) as Error & { status: number; payload: unknown };
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload as T;
}

export function fmtMoney(halalas: number | string): string {
  const v = Number(halalas) / 100;
  return v.toLocaleString("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtNum(n: number | string): string {
  return Number(n ?? 0).toLocaleString("ar-SA");
}

export function fmtDate(iso: string | Date, withTime = false): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: "نقدي",
  card: "بطاقة",
  insurance: "تأمين",
};

export const SEVERITY_LABEL: Record<string, string> = {
  major: "خطير",
  moderate: "متوسط",
  minor: "بسيط",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  sale: "بيع",
  restock: "تعبئة",
  adjust: "تسوية",
  return: "مرتجع",
};
