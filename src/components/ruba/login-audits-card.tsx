"use client";

import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

interface LoginAudit {
  id: string;
  username: string;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

/** بطاقة سجل تدقيق الدخول (v3.3) — مدير فقط: كل محاولة نجاح/فشل مع IP */
export function LoginAuditsCard() {
  const [audits, setAudits] = useState<LoginAudit[] | null>(null);
  const [failed24h, setFailed24h] = useState(0);

  useEffect(() => {
    api<{ audits: LoginAudit[]; failedLast24h: number }>(
      "/api/auth/login-audits?limit=50"
    )
      .then((r) => {
        setAudits(r.audits);
        setFailed24h(r.failedLast24h);
      })
      .catch(() => {
        toast.error("تعذر جلب سجل الدخول");
        setAudits([]);
      });
  }, []);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {failed24h > 0 ? (
          <ShieldAlert className="size-5 text-rose-500" />
        ) : (
          <ShieldCheck className="size-5 text-emerald-500" />
        )}
        <h3 className="font-bold">سجل تدقيق الدخول</h3>
        <Badge
          variant={failed24h > 0 ? "destructive" : "secondary"}
          className="num text-xs"
        >
          {failed24h} فشل / 24 ساعة
        </Badge>
      </div>
      {audits === null ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-teal-600" />
        </div>
      ) : audits.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          لا توجد محاولات دخول مسجلة بعد
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-muted">
              <TableRow>
                <TableHead className="text-xs">المستخدم</TableHead>
                <TableHead className="text-xs">النتيجة</TableHead>
                <TableHead className="hidden text-xs sm:table-cell">IP</TableHead>
                <TableHead className="text-xs">الوقت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audits.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm font-medium" dir="ltr">
                    {a.username}
                  </TableCell>
                  <TableCell>
                    {a.success ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 text-[10px]">
                        نجاح
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">
                        فشل
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="num hidden text-xs text-muted-foreground sm:table-cell" dir="ltr">
                    {a.ip ?? "—"}
                  </TableCell>
                  <TableCell className="num text-xs text-muted-foreground">
                    {fmtDate(a.createdAt, true)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
