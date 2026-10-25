import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "ربي فارمسي · نظام إدارة الصيدليات",
  description:
    "نظام إدارة صيدليات عربي متكامل — نقطة بيع، مخزون، مرضى، تقارير ذكية، وإشعارات استباقية. واجهة ويب احترافية عربية بالكامل.",
  keywords: ["صيدلية", "صيدليات", "نظام صيدليات", "نقطة بيع", "مخزون أدوية", "Ruba Pharmacy"],
  authors: [{ name: "فريق ربي فارمسي" }],
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0D9488",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className={`${tajawal.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
        <Sonner position="top-center" richColors dir="rtl" />
      </body>
    </html>
  );
}
