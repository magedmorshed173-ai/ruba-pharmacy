"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

/**
 * زر طباعة لقطة التقرير — مع طباعة تلقائية عند ?auto=1
 * (الرابط من إشعارات/أتمتة يفتح الصفحة فتُطبع مباشرة).
 */
export function PrintButton({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (auto) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [auto]);

  return (
    <Button
      onClick={() => window.print()}
      className="no-print bg-teal-600 hover:bg-teal-700"
      size="sm"
    >
      <Printer className="size-4" />
      طباعة / حفظ PDF
    </Button>
  );
}
