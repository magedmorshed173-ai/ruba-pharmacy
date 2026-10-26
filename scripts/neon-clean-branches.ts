/**
 * تنظيف فروع Neon المؤقتة للاختبارات الحية (v4.3) — التشغيل: bun scripts/neon-clean-branches.ts
 *
 * حاضنة e2e تحذف فرعها في finally، لكن أي فرع e2e-* يتيماً (فشل شبكة/إلغاء)
 * يُكنس هنا. آمن: لا يمس الفرع الأولي ولا أي فرع غير مسبوق بـ e2e-.
 * يتطلب NEON_API_KEY (يُقرأ من .env تلقائياً في بيئات bun).
 */
import { config } from "dotenv";
config({ override: process.env.DOTENV_KEEP_ENV !== "1", quiet: true });

const NEON_API = "https://console.neon.tech/api/v2";

async function neonFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.NEON_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Neon API ${res.status} على ${path}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    console.error("❌ لا يوجد NEON_API_KEY — لا شيء يمكن تنظيفه");
    process.exit(1);
  }
  let projectId = process.env.NEON_PROJECT_ID;
  if (!projectId) {
    const list = await neonFetch("/projects");
    const found = (list?.projects ?? []).find(
      (p: any) => p.name === "ruba-pharmacy"
    );
    if (!found) {
      console.log("✅ لا مشروع ruba-pharmacy — لا شيء لتنظيفه");
      return;
    }
    projectId = found.id;
  }
  const { branches } = await neonFetch(`/projects/${projectId}/branches`);
  const orphans = (branches ?? []).filter((b: any) =>
    /^e2e-/.test(b.name)
  );
  if (orphans.length === 0) {
    console.log("✅ لا فروع e2e-* يتيمة — كل شيء نظيف");
    return;
  }
  for (const b of orphans) {
    await neonFetch(`/projects/${projectId}/branches/${b.id}`, {
      method: "DELETE",
    });
    console.log(`🧹 حُذف الفرع اليتيم: ${b.name} (${b.id})`);
  }
  console.log(`✅ اكتمل التنظيف: ${orphans.length} فرعاً`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
