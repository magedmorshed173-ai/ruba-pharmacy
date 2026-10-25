"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api-client";
import { ROLE_LABEL } from "@/lib/role-label";
import { LoadingRows } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Loader2, ShieldCheck, UserCog, ShieldOff } from "lucide-react";

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: string;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { sales: number };
}

const EMPTY = { username: "", fullName: "", phone: "", role: "technician", password: "", isActive: true };

export function UsersView() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: UserRow[] }>("/api/users");
      setUsers(r.users);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطأ في جلب المستخدمين");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY });
    setFormOpen(true);
  }

  function openEdit(u: UserRow) {
    setEditing(u);
    setForm({
      username: u.username,
      fullName: u.fullName,
      phone: u.phone ?? "",
      role: u.role,
      password: "",
      isActive: u.isActive,
    });
    setFormOpen(true);
  }

  async function save() {
    if (!form.username.trim() || !form.fullName.trim()) {
      toast.error("اسم المستخدم والاسم الكامل مطلوبان");
      return;
    }
    if (!editing && form.password.length < 8) {
      toast.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          fullName: form.fullName,
          phone: form.phone,
          role: form.role,
          isActive: form.isActive,
        };
        if (form.password) payload.password = form.password;
        await api(`/api/users/${editing.id}`, { method: "PUT", json: payload });
        toast.success("تم تحديث المستخدم");
      } else {
        await api("/api/users", { method: "POST", json: form });
        toast.success("تمت إضافة المستخدم");
      }
      setFormOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: UserRow) {
    try {
      await api(`/api/users/${u.id}`, {
        method: "PUT",
        json: { isActive: !u.isActive },
      });
      toast.success(u.isActive ? "تم إيقاف الحساب" : "تم تفعيل الحساب");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذر التنفيذ");
    }
  }

  const roleBadge = (role: string) =>
    role === "admin"
      ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400"
      : role === "pharmacist"
        ? "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"
        : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openAdd} className="bg-teal-600 hover:bg-teal-700">
          <Plus className="size-4" /> مستخدم جديد
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {users === null ? (
          <LoadingRows rows={4} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المستخدم</TableHead>
                <TableHead className="hidden md:table-cell">الدور</TableHead>
                <TableHead className="hidden text-center sm:table-cell">المبيعات</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead className="hidden text-end lg:table-cell">التسجيل</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-teal-50 font-bold text-teal-700 dark:bg-teal-500/10 dark:text-teal-400">
                        {u.fullName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{u.fullName}</p>
                        <p className="num text-xs text-muted-foreground" dir="ltr">
                          @{u.username}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge className={`font-medium ${roleBadge(u.role)}`}>
                      {u.role === "admin" && <ShieldCheck className="me-1 size-3" />}
                      {ROLE_LABEL[u.role] ?? u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="num hidden text-center text-sm sm:table-cell">
                    {u._count?.sales ?? 0}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Switch
                        checked={u.isActive}
                        onCheckedChange={() => toggleActive(u)}
                        disabled={u.role === "admin"}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-end text-xs text-muted-foreground lg:table-cell">
                    {fmtDate(u.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(u)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="size-5 text-teal-600" />
              {editing ? `تعديل: ${editing.fullName}` : "إضافة مستخدم"}
            </DialogTitle>
            <DialogDescription>
              الأدوار: مدير النظام (كل الصلاحيات) · صيدلي (تعبئة وإلغاء فواتير) · فني (بيع وبحث)
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>اسم المستخدم *</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                disabled={!!editing}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>الاسم الكامل *</Label>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>الهاتف</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>الدور</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">مدير النظام</SelectItem>
                  <SelectItem value="pharmacist">صيدلي</SelectItem>
                  <SelectItem value="technician">فني صيدلة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{editing ? "كلمة مرور جديدة (اتركها فارغة للإبقاء)" : "كلمة المرور *"}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                dir="ltr"
                placeholder="••••••••"
              />
            </div>
            {editing && (
              <div className="flex items-center gap-3 rounded-lg border p-3 sm:col-span-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                />
                <div className="flex items-center gap-1.5 text-sm">
                  <ShieldOff className="size-4 text-muted-foreground" />
                  حساب فعال
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={save} disabled={saving} className="bg-teal-600 hover:bg-teal-700">
              {saving ? <Loader2 className="size-4 animate-spin" /> : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
