#!/usr/bin/env bash
# ============================================================================
# صيدلية رُبى — المثبّت الشامل v4.6.6
# يعمل على: Linux (كل التوزيعات) · macOS · WSL · Termux/Android (عبر proot-debian)
#
# الاستخدام:
#   curl -fsSL https://raw.githubusercontent.com/magedmorshed173-ai/ruba-pharmacy/main/scripts/install.sh | bash
#   أو بعد النسخ:  bash scripts/install.sh [خيارات]
#
# الخيارات:
#   --docker          استخدم Docker Compose بدل التشغيل الأصلي (الأسهل على الخوادم)
#   --seed=catalog    بذر كتالوج الدواء والسجل الوطني (إنتاج نظيف)
#   --seed=full       بذر كامل تجريبي مع مبيعات (للتجربة فقط)
#   --dir=PATH        مجلد التثبيت (افتراضي: ~/ruba-pharmacy أو المجلد الحالي إن كان نسخة المشروع)
#   --port=N          منفذ التشغيل (افتراضي 3000)
#   --service         تثبيت خدمة systemd مستخدم (إقلاع تلقائي — Linux فقط)
#   --no-run          لا تشغّل الخادم بعد البناء
#
# الأمان: كل القيم الحساسة تُقرأ بإخفاء ولا تُطبع أبداً؛ القاعدة السحابية (Neon)
# لا تُكتب إلا في ملف .env المحلي (chmod 600) داخل مجلد التطبيق.
# ============================================================================
set -euo pipefail

REPO_URL="https://github.com/magedmorshed173-ai/ruba-pharmacy.git"
RAW_URL="https://raw.githubusercontent.com/magedmorshed173-ai/ruba-pharmacy/main/scripts/install.sh"

# ── المخرجات الملوّنة ──
say()  { printf "\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }
hr()   { printf "\033[2m──────────────────────────────────────────────\033[0m\n"; }
mask_url() { printf '%s' "$1" | sed -E 's|(//)[^@/]*@|\1***@|'; }

MODE="native"; SEED="skip"; PORT=3000; DO_SERVICE=0; DO_RUN=1; APP_DIR=""
for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    --seed=catalog) SEED="catalog" ;;
    --seed=full) SEED="full" ;;
    --dir=*) APP_DIR="${arg#--dir=}" ;;
    --port=*) PORT="${arg#--port=}" ;;
    --service) DO_SERVICE=1 ;;
    --no-run) DO_RUN=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "خيار غير معروف: $arg (جرّب --help)" ;;
  esac
done

# ── 0) Termux: أعِد الدخول داخل Debian (proot) حيث تعمل كل الأدوات glibc ──
if [ -n "${TERMUX_VERSION:-}" ] && [ -z "${RUBA_IN_PROOT:-}" ]; then
  say "بيئة Termux مكتشفة — سنجهّز Debian كاملة داخل proot (بلا جذر، آمن ومعزول)"
  command -v proot-distro >/dev/null 2>&1 || { pkg update -y; pkg install -y proot-distro; }
  proot-distro list 2>/dev/null | grep -qE "debian" || proot-distro install debian
  say "الدخول إلى Debian وتشغيل المثبّت داخله…"
  proot-distro login debian -- bash -c "
    export DEBIAN_FRONTEND=noninteractive RUBA_IN_PROOT=1
    apt-get update -y -qq && apt-get install -y -qq curl git ca-certificates openssl xz-utils procps tzdata
    curl -fsSL '$RAW_URL' | bash -s -- $*"
  ok "تم — للدخول إلى التطبيق مستقبلاً:  proot-distro login debian"
  exit 0
fi

hr; say "صيدلية رُبى — تثبيت v4.6.6 (الوضع: ${MODE})"; hr

# ── 1) أدوات أساسية ──
command -v curl >/dev/null 2>&1 || die "curl مطلوب — ثبّته أولاً (apt install curl)"
command -v git  >/dev/null 2>&1 || die "git مطلوب — ثبّته أولاً (apt install git)"

# ── 2) مجلد التطبيق: المجلد الحالي إن كان نسخة المشروع، وإلا نسخة جديدة ──
if [ -z "$APP_DIR" ]; then
  if [ -f "./package.json" ] && [ -f "./prisma/schema.prisma" ]; then
    APP_DIR="$PWD"; ok "تشغيل داخل نسخة موجودة: $APP_DIR"
  else
    APP_DIR="$HOME/ruba-pharmacy"
  fi
fi
if [ ! -f "$APP_DIR/package.json" ]; then
  say "نسخ المشروع إلى $APP_DIR …"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
ok "مجلد التطبيق: $APP_DIR"

# ── 3) وضع Docker: كل شيء داخل حاويات ──
if [ "$MODE" = "docker" ]; then
  command -v docker >/dev/null 2>&1 || die "Docker غير مثبّت — ثبّت Docker Desktop أو Engine أولاً"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 مطلوب"
  if [ ! -f ".env" ]; then
    say "توليد AUTH_SECRET وكتابة .env …"
    AUTH="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf 'AUTH_SECRET="%s"\nPOSTGRES_PASSWORD="%s"\n' "$AUTH" \
      "$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" > .env
    chmod 600 .env
  fi
  set -a; . ./.env; set +a
  docker compose up -d --build
  [ "$SEED" = "full" ] && docker compose run --rm seed
  ok "الخدمة تعمل:  docker compose ps"
  say "الواجهة:  http://localhost:3000   (السجلات: docker compose logs -f ruba-pharmacy)"
  exit 0
fi

# ── 4) بيئة التشغيل: Bun (المفضّل) وإلا Node.js ──
RUNTIME=""
if command -v bun >/dev/null 2>&1; then
  RUNTIME="bun"
elif [ "${RUBA_SKIP_BUN:-0}" != "1" ]; then
  say "تثبيت Bun …"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || warn "تعذر تثبيت Bun — سنستخدم Node.js"
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 && RUNTIME="bun"
fi
if [ -z "$RUNTIME" ]; then
  if ! command -v node >/dev/null 2>&1; then
    say "تثبيت Node.js 22 (محلياً في ~/.local — بلا صلاحيات جذر) …"
    NODE_V="22.14.0"; case "$(uname -m)" in x86_64) NA=x64 ;; aarch64|arm64) NA=arm64 ;; *) die "معمارية غير مدعومة: $(uname -m)" ;; esac
    mkdir -p "$HOME/.local/ruba-node"
    curl -fsSL "https://nodejs.org/dist/v${NODE_V}/node-v${NODE_V}-linux-${NA}.tar.xz" \
      | tar -xJ -C "$HOME/.local/ruba-node"
    export PATH="$HOME/.local/ruba-node/node-v${NODE_V}-linux-${NA}/bin:$PATH"
  fi
  RUNTIME="node"
fi
ok "بيئة التشغيل: $RUNTIME ($( { bun --version || node --version; } 2>/dev/null | head -1 ))"

# ── 5) الاعتماديات ──
if [ "$RUNTIME" = "bun" ]; then
  bun install --frozen-lockfile
else
  say "Node.js: تثبيت الاعتماديات بـ npm (بلا ملف قفل — سيُولَّد package-lock.json)…"
  npm install --no-audit --no-fund
fi

# ── 6) قاعدة البيانات والإعدادات (.env) ──
if [ -f ".env" ]; then
  ok "ملف .env موجود — سيُعاد استخدامه (احذفه لإعادة الضبط)"
else
  say "إعداد الاتصال بقاعدة البيانات:"
  echo "  (أ) قاعدة سحابية Neon — الصق السلسلة المجمّعة (pooled) من Vercel → Storage → Neon → Connection string"
  echo "  (ب) قاعدة محلية — سأجهّزها لك بعدها عبر Docker (أو Postgres مثبّت محلياً)"
  printf "اختر (a/b): "
  read -r DBCHOICE
  if [ "${DBCHOICE:-a}" = "a" ]; then
    printf "DATABASE_URL المجمّعة (الإدخال مخفي): "
    read -rs DATABASE_URL; echo
    case "$DATABASE_URL" in postgresql://*) ;; *) die "السلسلة يجب أن تبدأ بـ postgresql://" ;; esac
    DIRECT_URL="${DATABASE_URL//-pooler./.}"   # الترحيلات تفضّل المباشرة بلا -pooler
    say "المباشرة المشتقة: $(mask_url "$DIRECT_URL")"
  else
    warn "شغّل Postgres محلياً ثم أعِد هذا الخطوة؛ مثال سريع:"
    echo "  docker run -d --name ruba-db -e POSTGRES_PASSWORD=ruba_local -e POSTGRES_DB=ruba -p 5432:5432 postgres:16-alpine"
    printf "DATABASE_URL المحلية (الإدخال مخفي): "
    read -rs DATABASE_URL; echo
    DIRECT_URL="$DATABASE_URL"
  fi
  AUTH_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  { echo "# صيدلية رُبى — مولّد آلياً بواسطة install.sh — لا تُنشر أبداً"
    printf 'DATABASE_URL="%s"\nDIRECT_URL="%s"\nAUTH_SECRET="%s"\n' \
      "$DATABASE_URL" "$DIRECT_URL" "$AUTH_SECRET"
  } > .env
  chmod 600 .env
  ok "كُتب .env (600) — القيم مخفية ولن تُطبع"
fi
set -a; . ./.env; set +a

# ── 7) الترحيلات ──
say "تطبيق الترحيلات على القاعدة (prisma migrate deploy)…"
if [ "$RUNTIME" = "bun" ]; then bunx prisma migrate deploy; else npx -y prisma migrate deploy; fi

# ── 8) البذر (اختياري) ──
if [ "$SEED" != "skip" ]; then
  say "البذر (وضع: $SEED)…"
  if [ "$RUNTIME" = "bun" ]; then
    [ "$SEED" = "catalog" ] && { bun scripts/seed-drugs.ts; bun scripts/seed-national.ts; }
    [ "$SEED" = "full" ] && bun scripts/seed.ts
    [ -n "${RUBA_ADMIN_PASSWORD:-}" ] && bun scripts/seed-admin.ts || true
  else
    npx -y tsx scripts/seed-drugs.ts && ([ "$SEED" = "full" ] && npx -y tsx scripts/seed.ts || npx -y tsx scripts/seed-national.ts) || \
      warn "تعذر البذر عبر tsx — جرّب وضع Docker للبذر (docker compose run --rm seed)"
  fi
fi

# ── 9) البناء ──
say "بناء نسخة الإنتاج (next build + standalone)…"
if [ "$RUNTIME" = "bun" ]; then bun run build; else npm run build; fi
ok "اكتمل البناء"

# ── 10) خدمة systemd (اختياري — Linux) ──
if [ "$DO_SERVICE" = "1" ] && command -v systemctl >/dev/null 2>&1; then
  NODE_BIN="$(command -v node || echo node)"
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/ruba-pharmacy.service" <<EOF
[Unit]
Description=Ruba Pharmacy Platform v4.6.6
After=network-online.target
[Service]
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$NODE_BIN .next/standalone/server.js
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now ruba-pharmacy.service 2>/dev/null || \
    warn "فعّل البقاء بعد الخروج:  sudo loginctl enable-linger $USER"
  ok "الخدمة مثبتة:  systemctl --user status ruba-pharmacy"
  exit 0
fi

# ── 11) التشغيل ──
LAN_IP="$( { hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null; } | awk '{print $1}' )"
if [ "$DO_RUN" = "1" ]; then
  say "تشغيل الخادم على المنفذ $PORT (في الخلفية، السجل: server.log)…"
  PORT="$PORT" NODE_ENV=production nohup node .next/standalone/server.js > server.log 2>&1 &
  echo $! > .server.pid
  sleep 3
  curl -fsS "http://127.0.0.1:${PORT}/api" >/dev/null 2>&1 && ok "الخادم يستجيب ✓" || warn "لم يستجب بعد — راجع server.log"
fi

hr; ok "اكتمل التثبيت — صيدلية رُبى v4.6.6"
echo "   محلياً:      http://localhost:${PORT}"
[ -n "${LAN_IP:-}" ] && echo "   على الشبكة:  http://${LAN_IP}:${PORT}   (للهواتف والأجهزة الأخرى في نفس الشبكة)"
echo "   إيقاف:       kill \$(cat .server.pid)"
echo "   تثبيت كتطبيق: افتح الرابط في المتصفح ← «تثبيت التطبيق» (PWA)"
hr
