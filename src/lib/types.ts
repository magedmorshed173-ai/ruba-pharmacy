export type Role = "admin" | "pharmacist" | "technician";

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  description?: string | null;
  _count?: { medicines: number };
}

export interface Medicine {
  id: string;
  name: string;
  genericName: string;
  categoryId: string;
  category: { id: string; name: string };
  manufacturer?: string | null;
  barcode: string;
  purchasePrice: number; // هللات
  sellingPrice: number; // هللات
  quantity: number;
  minQuantity: number;
  expiryDate: string;
  productionDate?: string | null;
  dosage?: string | null;
  requiresPrescription: boolean;
  isActive: boolean;
  isExpired?: boolean;
  daysUntilExpiry?: number;
  isLowStock?: boolean;
}

export interface StockMovement {
  id: string;
  medicineId: string;
  medicine?: { name: string; barcode: string };
  type: "sale" | "restock" | "adjust" | "return";
  delta: number;
  balanceAfter: number;
  reference?: string | null;
  user?: { username: string; fullName: string } | null;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  medicineId: string;
  medicineName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  medicine?: { barcode: string; quantity: number };
}

export interface Sale {
  id: string;
  customerName: string;
  customerPhone?: string | null;
  itemsCount: number;
  totalAmount: number;
  discount: number;
  netAmount: number;
  paymentMethod: string;
  status: "completed" | "void";
  reference: string;
  user?: { username: string; fullName: string };
  saleDate: string;
  items: SaleItem[];
}

export interface Patient {
  id: string;
  name: string;
  nationalId: string;
  phone?: string | null;
  chronicMedications?: string | null;
  allergies?: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  kind: "expiry" | "low_stock" | "info";
  title: string;
  body?: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface InteractionHit {
  genericA: string;
  genericB: string;
  severity: "major" | "moderate" | "minor";
  description: string;
  management?: string | null;
}

export interface DashboardStats {
  revenueToday: number;
  revenueMonth: number;
  salesCountToday: number;
  totalMedicines: number;
  lowStockCount: number;
  expiredCount: number;
  expiring30Count: number;
  inventoryCostValue: number;
  unreadNotifications: number;
}

export interface SmartRestockRow {
  medicineId: string;
  name: string;
  barcode: string;
  quantity: number;
  soldLast30: number;
  dailyVelocity: number;
  daysOfCover: number | null;
  suggestedOrder: number;
}
