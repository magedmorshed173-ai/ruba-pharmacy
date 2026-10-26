"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { api, type AuthUser } from "@/lib/api-client";
import { LoginView } from "./login-view";
import { DashboardView } from "./dashboard-view";
import { PosView } from "./pos-view";
import { InventoryView } from "./inventory-view";
import { SuppliersView } from "./suppliers-view";
import { PatientsView } from "./patients-view";
import { ReportsView } from "./reports-view";
import { NotificationsView } from "./notifications-view";
import { UsersView } from "./users-view";
import { SettingsView } from "./settings-view";
import { VerifyQueueView } from "./verify-queue-view";
import { LoginAuditsCard } from "./login-audits-card";
import { OfflineBanner } from "./offline-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Truck,
  UsersRound,
  BarChart3,
  Bell,
  UserCog,
  Settings,
  LogOut,
  Pill,
  Menu,
  X,
  ChevronDown,
  ClipboardCheck,
} from "lucide-react";
import { ROLE_LABEL } from "@/lib/role-label";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

type ViewKey =
  | "dashboard"
  | "pos"
  | "verify"
  | "inventory"
  | "suppliers"
  | "patients"
  | "reports"
  | "notifications"
  | "users"
  | "settings";

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard; minRole?: string }[] = [
  { key: "dashboard", label: "الرئيسية", icon: LayoutDashboard },
  { key: "pos", label: "نقطة البيع", icon: ShoppingCart },
  { key: "verify", label: "طابور التحقق", icon: ClipboardCheck },
  { key: "inventory", label: "المخزون", icon: Package },
  { key: "suppliers", label: "المشتريات", icon: Truck, minRole: "pharmacist" },
  { key: "patients", label: "المرضى", icon: UsersRound },
  { key: "reports", label: "التقارير", icon: BarChart3 },
  { key: "notifications", label: "الإشعارات", icon: Bell },
  { key: "users", label: "المستخدمون", icon: UserCog, minRole: "admin" },
  { key: "settings", label: "الإعدادات", icon: Settings },
];

const ROLE_RANK: Record<string, number> = { technician: 1, pharmacist: 2, admin: 3 };

export function AppShell() {
  const [user, setUser] = useState<AuthUser | null | "loading">("loading");
  const [view, setView] = useState<ViewKey>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const { resolvedTheme, setTheme } = useTheme();

  const refreshUnread = useCallback(async () => {
    try {
      const r = await api<{ unreadCount: number }>("/api/notifications");
      setUnread(r.unreadCount);
    } catch {
      /* تجاهل */
    }
  }, []);

  useEffect(() => {
    api<{ user: AuthUser }>("/api/auth/me")
      .then((r) => {
        setUser(r.user);
        refreshUnread();
      })
      .catch(() => setUser(null));
  }, [refreshUnread]);

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.reload();
    }
  }

  if (user === "loading") {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 shrink-0 border-e bg-card p-4 lg:block">
          <Skeleton className="h-10 w-36" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-12 w-64" />
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="mt-6 h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user) return <LoginView />;

  const visibleNav = NAV.filter(
    (n) => !n.minRole || (ROLE_RANK[user.role] ?? 0) >= (ROLE_RANK[n.minRole] ?? 99)
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-[oklch(0.265_0.045_220)] text-white">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-teal-500 shadow-lg shadow-teal-500/25">
          <Pill className="size-5" />
        </div>
        <div>
          <p className="text-lg font-extrabold leading-none">ربي فارمسي</p>
          <p className="mt-1 text-[9px] tracking-[0.3em] text-teal-300/70">RUBA PHARMACY</p>
        </div>
      </div>

      <nav className="sidebar-scroll flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {visibleNav.map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                setView(item.key);
                setSidebarOpen(false);
                if (item.key === "notifications") refreshUnread();
              }}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all",
                active
                  ? "bg-teal-500/95 text-white shadow-md shadow-teal-500/20"
                  : "text-white/65 hover:bg-white/8 hover:text-white"
              )}
            >
              <item.icon className={cn("size-[18px]", active ? "text-white" : "text-teal-300/80")} />
              {item.label}
              {item.key === "notifications" && unread > 0 && (
                <span className="num ms-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-9 border border-teal-400/30">
            <AvatarFallback className="bg-teal-500/20 text-sm font-bold text-teal-300">
              {user.fullName.trim().charAt(0) || "؟"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{user.fullName}</p>
            <p className="text-[11px] text-teal-300/80">
              {ROLE_LABEL[user.role] ?? user.role}
            </p>
          </div>
          <button
            onClick={logout}
            title="تسجيل الخروج"
            className="rounded-lg p-2 text-white/50 transition hover:bg-white/10 hover:text-rose-300"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* الشريط الجانبي — ثابت على اليمين في RTL */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">{sidebar}</aside>

      {/* شريط جوال */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 end-0 w-72 shadow-2xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        {/* الشريط العلوي */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="text-base font-bold lg:text-lg">
            {visibleNav.find((n) => n.key === view)?.label}
          </h1>

          <div className="ms-auto flex items-center gap-2">
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="تبديل الوضع الليلي"
              title="الوضع الليلي / النهاري"
            >
              <Sun className="size-5 dark:hidden" />
              <Moon className="hidden size-5 dark:block" />
            </button>
            <button
              onClick={() => {
                setView("notifications");
              }}
              className="relative rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="الإشعارات"
            >
              <Bell className="size-5" />
              {unread > 0 && (
                <span className="num absolute -top-0.5 -start-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-accent">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-teal-600 text-xs font-bold text-white">
                      {user.fullName.trim().charAt(0) || "؟"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-start sm:block">
                    <p className="max-w-32 truncate text-xs font-bold">{user.fullName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {ROLE_LABEL[user.role] ?? user.role}
                    </p>
                  </div>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs">
                  {user.username}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setView("settings")}>
                  <Settings className="size-4" /> الإعدادات
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
                  <LogOut className="size-4" /> تسجيل الخروج
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* المحتوى */}
        <main className="flex-1 p-4 lg:p-6">
          {view === "dashboard" && <DashboardView user={user} onNavigate={setView} />}
          {view === "pos" && <PosView user={user} onDone={refreshUnread} />}
          {view === "verify" && <VerifyQueueView user={user} />}
          {view === "inventory" && <InventoryView user={user} />}
          {view === "suppliers" && user.role !== "technician" && <SuppliersView user={user} />}
          {view === "patients" && <PatientsView user={user} />}
          {view === "reports" && <ReportsView user={user} />}
          {view === "notifications" && <NotificationsView onRead={refreshUnread} />}
          {view === "users" && user.role === "admin" && (
            <div className="space-y-4">
              <UsersView />
              <LoginAuditsCard />
            </div>
          )}
          {view === "settings" && <SettingsView user={user} onLogout={logout} />}
        </main>

        <footer className="mt-auto border-t bg-card/60 py-3 text-center text-xs text-muted-foreground">
          ربي فارمسي · منصة إدارة الصيدليات العربية · إصدار 3.6
        </footer>
      </div>
    </div>
  );
}
