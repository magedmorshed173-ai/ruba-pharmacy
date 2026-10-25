#!/usr/bin/env bash
# ربي فارمسي — بناء حزمة Android (AAB) للتطبيق التقدمي PWA عبر Bubblewrap
# المتطلبات: JDK 17+ (متوفر 21)، Node/npm، ورابط الموقع المنشور (HTTPS)
# الاستخدام: LIVE_URL="https://ruba-pharmacy.vercel.app" bash scripts/build-twa.sh
set -euo pipefail

LIVE_URL="${LIVE_URL:?❌ مرّر رابط موقعك المنشور: LIVE_URL=https://... bash scripts/build-twa.sh}"
KS_FILE="${KS_FILE:-${HOME}/.ruba-play/ruba-upload.jks}"
KS_PASS="${KS_PASS:?❌ مرّر كلمة مرور المفتاح: KS_PASS=... }"
APP_ID="${APP_ID:-sa.rubapharmacy.app}"
OUT_DIR="${HOME}/.ruba-play/twa"

mkdir -p "${OUT_DIR}" && cd "${OUT_DIR}"

# 1) تثبيت Bubblewrap CLI إن غاب
command -v bubblewrap >/dev/null 2>&1 || npm install -g @bubblewrap/cli

# 2) تهيئة المشروع مرة واحدة
if [[ ! -f twa-manifest.json ]]; then
  bubblewrap init --manifest="${LIVE_URL}/manifest.webmanifest" \
    --directory=. --packageId="${APP_ID}"
fi

# 3) تحديث الرابط ثم البناء الموقّع
bubblewrap update --appVersionName="3.4.0" --appVersionCode=34
bubblewrap build --skipPwaValidation

AAB=$(ls -t app-release-bundle.aab 2>/dev/null | head -1 || true)
[[ -n "${AAB}" ]] || { echo "❌ لم يُنتج AAB — راجع رسائل bubblewrap"; exit 1; }

echo
echo "✅ الحزمة جاهزة: ${OUT_DIR}/${AAB}"
echo
echo "── بصمة SHA-256 لتوقيعك (انسخها إلى assetlinks.json):"
keytool -list -v -keystore "${KS_FILE}" -alias ruba-upload -storepass "${KS_PASS}" \
  | grep "SHA256:" | awk '{print $2}'
echo
echo "الخطوة التالية: ضع البصمة في public/.well-known/assetlinks.json بدليل docs/STEPS.md — المرحلة د"
