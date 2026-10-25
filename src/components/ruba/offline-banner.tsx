"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** مؤشر دون اتصال (v3.4) — شريط ثابت يظهر عند فقدان الشبكة */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 py-1.5 text-xs font-bold text-white shadow-md">
      <WifiOff className="size-3.5" />
      أنت دون اتصال — لن يمكن إتمام البيع أو الحفظ حتى عودة الشبكة
    </div>
  );
}
