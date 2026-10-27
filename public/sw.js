/*
 * ربي فارمسي — Service Worker (v4.8.0)
 * ─────────────────────────────────────────────────────────────
 * العمل دون اتصال بأحدث الاستراتيجيات القياسية:
 *  - Precache عند التثبيت: صفحة /offline (سقوط نهائي للتنقلات).
 *  - Navigation Preload: طلب الشبكة يبدأ موازياً لتفعيل الـ SW —
 *    يلغي تأخّر الـ SW على التنقلات (أفضل ممارسة Chrome).
 *  - الأصول الثابتة (/_next/static، أنماط، سكربتات، خطوط، صور):
 *    Stale-While-Revalidate — فوري من الكاش مع تحديث بالخلفية.
 *  - التنقلات (HTML): Network-First مع خبز الصفحات المزارة
 *    لمدة ساعة (TTL أقصر بكثير من أدنى مدة قفل افتراضية 4 ساعات —
 *    لا صفحات قديمة تعيش بعد إقفال النظام).
 *  - /api/*: شبكة فقط — لا يُخبَّز أي بيان تشغيلي إطلاقاً.
 *  - بوابة القفل (v4.7) فوق كل هذا: عند إقفال النظام يرسل المراقب
 *    PURGE_PAGES فيُمحى خبز الصفحات فوراً (دفاع في العمق).
 *
 * التحديث: VERSION الجديد ⇒ أسماء كاش جديدة ⇒ activate يمحو القديم.
 */

const VERSION = "v4.8.0";
const STATIC_CACHE = `ruba-static-${VERSION}`;
const PAGE_CACHE = `ruba-pages-${VERSION}`;

/** ساعة واحدة — أقصى عمر لصفحة مخبأة (أقصر من أدنى TTL قفل = ساعة، والافتراضي 4 ساعات) */
const PAGE_TTL_MS = 60 * 60 * 1000;

const PRECACHE_URLS = ["/offline"];

/* ── التثبيت: خبز صفحة السقوط (تسامح مع فشل عنصر واحد) ── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })()
  );
});

/* ── التفعيل: Navigation Preload + محو الكاش القديم ── */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        if (self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
      } catch {
        /* متصفحات لا تدعمه — تجاهل */
      }
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (n) =>
              n.startsWith("ruba-") && n !== STATIC_CACHE && n !== PAGE_CACHE
          )
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/* ── الجلب ── */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // الواجهات: شبكة فقط — أبسط وأأمن (لا بيانات تشغيلية في الكاش إطلاقاً)
  if (url.pathname.startsWith("/api/")) return;
  // مقاطع الوسائط المتدفقة تدير نفسها
  if (req.headers.has("range")) return;

  // 1) الأصول الثابتة: Stale-While-Revalidate
  if (
    url.pathname.startsWith("/_next/static/") ||
    req.destination === "style" ||
    req.destination === "script" ||
    req.destination === "font" ||
    req.destination === "image"
  ) {
    event.respondWith(staleWhileRevalidate(event, req));
    return;
  }

  // 2) التنقلات (HTML): Network-First + خبز ساعة + سقوط إلى /offline
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(event, req));
  }
  // 3) ما عدا ذلك (RSC، manifest…): سلوك المتصفح الطبيعي
});

/** كاش-أولاً مع تحديث خلفي — أصول غير قابلة للتغيير (مبتهجة بالبصمة) */
async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  const refresh = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        // put يستهلك نسخة — الأصل يُعاد للمتصفح
        event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      }
      return res;
    })
    .catch(() => null);

  if (cached) return cached;

  const fresh = await refresh;
  return fresh || Response.error();
}

/** شبكة-أولاً للتنقلات: الأحدث يفوز، والسقوط متدرج (خبز ساعة ← /offline) */
async function networkFirstPage(event, req) {
  let res = null;
  try {
    // Navigation Preload: الطلب بدأ موازياً — نجاريه إن وُجد
    res = (event.preloadResponse && (await event.preloadResponse)) || null;
  } catch {
    /* تجاهل */
  }
  if (!res) {
    try {
      res = await fetch(req);
    } catch {
      res = null;
    }
  }

  if (res && res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
    try {
      const cache = await caches.open(PAGE_CACHE);
      const clone = res.clone();
      const headers = new Headers(clone.headers);
      headers.set("x-ruba-cached-at", String(Date.now()));
      const stamped = new Response(clone.body, {
        status: clone.status,
        statusText: clone.statusText,
        headers,
      });
      event.waitUntil(cache.put(req, stamped).catch(() => {}));
    } catch {
      /* الخبز لا يعطل الاستجابة أبداً */
    }
    return res;
  }
  if (res) return res; // (توجيه 307 للقفل، 404…) — يمر كما هو

  // دون اتصال: صفحة مزارة حديثاً (أحدث من ساعة)؟
  try {
    const cache = await caches.open(PAGE_CACHE);
    const cached = await cache.match(req);
    if (cached) {
      const at = Number(cached.headers.get("x-ruba-cached-at") || 0);
      if (at && Date.now() - at < PAGE_TTL_MS) return cached;
    }
    const staticCache = await caches.open(STATIC_CACHE);
    const offline =
      (await staticCache.match("/offline")) ||
      (await cache.match("/offline"));
    if (offline) return offline;
  } catch {
    /* تجاهل */
  }
  return new Response("لا يوجد اتصال بالإنترنت", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/* ── أوامر من الصفحة ── */
self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  // عند إقفال النظام (انتهاء/سحب/تغيير كلمة مرور): تمحيص فوري لخبز الصفحات
  if (type === "PURGE_PAGES") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  }
});
