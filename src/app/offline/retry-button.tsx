"use client";

import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

/** زر إعادة المحاولة — يعيد التحميل الكامل ليعيد النظام التحقق من الشبكة والقفل */
export function OfflineRetry() {
  return (
    <Button
      onClick={() => window.location.reload()}
      className="mt-8 gap-2"
      size="lg"
    >
      <RefreshCw className="size-4" />
      إعادة المحاولة
    </Button>
  );
}
