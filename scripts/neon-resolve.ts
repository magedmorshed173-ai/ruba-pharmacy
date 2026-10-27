/**
 * حلّ أو أنشئ مشروع Neon واستخرج سلسلتي الاتصال — v4.6.3
 * يعمل داخل workflow «Neon Bootstrap»: يقرأ NEON_API_KEY من البيئة،
 * يجد مشروع ruba-pharmacy أو ينشئه (aws-us-east-2 / pg16 — قرب Vercel
 * iad1)، ينتظر جاهزية نقطة النهاية، ثم يصدّر DATABASE_URL (المجمّعة)
 * و DIRECT_URL (المباشرة) إلى $GITHUB_env — مع إخفاء كامل (::add-mask::)
 * لكل قيمة حساسة: السجل عمومي والسلاسل تحمل كلمة مرور مالك الدور.
 * التشغيل: bun scripts/neon-resolve.ts (داخل GitHub Actions فقط —
 * بيئات التطوير المقيّدة شبكياً لا تصل إلى نطاقات neon.tech أصلاً).
 */
import { appendFileSync } from "node:fs";

const API = "https://api.neon.tech/v2";
const PROJECT_NAME = process.env.NEON_PROJECT_NAME || "ruba-pharmacy";

type Project = {
  id: string;
  name: string;
  pg_version: number;
  region_id: string;
};
type Branch = { id: string; name: string; default?: boolean };
type Endpoint = { id: string; host: string; status?: string };

/** أمر Actions: أي ظهور لاحق للقيمة في سجلات المهمة يُستبدل بنجوم */
function mask(value: string): void {
  console.log(`::add-mask::${value}`);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.NEON_API_KEY;
  if (!key) {
    console.error(
      "::error::NEON_API_KEY غير مضبوط — أضفه من console.neon.tech (Account → API Keys) إلى: Settings → Secrets and variables → Actions"
    );
    process.exit(1);
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    console.error(
      `::error::فشل نداء Neon API ${init?.method ?? "GET"} ${path} — الحالة ${res.status}`
    );
    console.error(await res.text());
    process.exit(1);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  // 1) ابحث عن المشروع أو أنشئه
  const list = await api<{ projects: Project[] }>("/projects");
  let project = list.projects.find((p) => p.name === PROJECT_NAME);
  if (project) {
    console.log(
      `مشروع موجود: ${project.name} (${project.id}) — pg${project.pg_version} @ ${project.region_id}`
    );
  } else {
    console.log(
      `::notice::لا مشروع باسم ${PROJECT_NAME} — إنشاء جديد على aws-us-east-2 (الأقرب لـ Vercel iad1)`
    );
    const created = await api<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify({
        project: { name: PROJECT_NAME, pg_version: 16, region_id: "aws-us-east-2" },
      }),
    });
    project = created.project;
    console.log(`أُنشئ المشروع: ${project.name} (${project.id})`);
  }

  // 2) الفرع الافتراضي
  const branches = await api<{ branches: Branch[] }>(
    `/projects/${project.id}/branches`
  );
  const branch =
    branches.branches.find((b) => b.default) ?? branches.branches[0];
  if (!branch) {
    console.error("::error::لا فرع افتراضي في المشروع");
    process.exit(1);
  }

  // 3) انتظر جاهزية نقاط النهاية (حتى ~90 ثانية بعد الإنشاء)
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const eps = await api<{ endpoints: Endpoint[] }>(
      `/projects/${project.id}/branches/${branch.id}/endpoints`
    );
    const statuses = eps.endpoints.map((e) => e.status ?? "ready");
    if (
      statuses.length > 0 &&
      statuses.every((s) => s === "ready" || s === "idle")
    ) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!ready) {
    console.error("::error::انتهت مهلة انتظار جاهزية نقطة نهاية Neon (90 ثانية)");
    process.exit(1);
  }

  // 4) سلسلتا الاتصال — المجمّعة (-pooler) للتشغيل والمباشرة للترحيلات
  const pooled = await api<{ uri: string }>(
    `/projects/${project.id}/branches/${branch.id}/connection_uri?pooled=true`
  );
  const direct = await api<{ uri: string }>(
    `/projects/${project.id}/branches/${branch.id}/connection_uri?pooled=false`
  );
  for (const uri of [pooled.uri, direct.uri]) {
    mask(uri);
    try {
      const u = new URL(uri);
      if (u.password) mask(u.password);
      if (u.hostname) mask(u.hostname);
    } catch {
      /* الإخفاء الكامل للسلسلة يكفي */
    }
  }

  // 5) صدّر إلى $GITHUB_ENV بصيغة heredoc الآمنة للرموز الخاصة
  const envFile = process.env.GITHUB_ENV;
  if (!envFile) {
    console.error(
      "::error::GITHUB_ENV غير متوفر — هذا السكربت يعمل داخل GitHub Actions حصراً"
    );
    process.exit(1);
  }
  appendFileSync(envFile, `DATABASE_URL<<NEON_EOF\n${pooled.uri}\nNEON_EOF\n`);
  appendFileSync(envFile, `DIRECT_URL<<NEON_EOF\n${direct.uri}\nNEON_EOF\n`);
  console.log(
    "✅ سلسلتا الاتصال حُلّتا وصُدّرتا إلى بيئة المهمة (مخفيتان في السجلات): pooled للتشغيل + direct للترحيلات"
  );
}

await main();
