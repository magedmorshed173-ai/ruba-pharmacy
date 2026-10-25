#!/usr/bin/env bash
# ربي فارمسي — توليد مفتاح توقيع Google Play (Upload Key)
# الاستخدام: bash scripts/make-keystore.sh
# ⚠️ احفظ كلمة المرور في مدير كلمات — فقدان المفتاح = فقدان تحديثات التطبيق
set -euo pipefail

KS_DIR="${HOME}/.ruba-play"
KS_FILE="${KS_DIR}/ruba-upload.jks"
mkdir -p "${KS_DIR}"

if [[ -f "${KS_FILE}" ]]; then
  echo "⚠️  المفتاح موجود مسبقاً: ${KS_FILE}"
  echo "   لإعادة التوليد انقله أولاً. لا تحذفه أبداً!"
  exit 1
fi

read -rp "اسم المتجر (مثال: صيدلية ربي - فرع الرياض): " STORE_NAME
read -rsp "كلمة مرور المفتاح (8+ حروف، ستبقى مخفية): " KS_PASS; echo
[[ ${#KS_PASS} -ge 8 ]] || { echo "❌ كلمة المرور قصيرة"; exit 1; }

keytool -genkeypair -v \
  -keystore "${KS_FILE}" \
  -alias ruba-upload \
  -keyalg RSA -keysize 2048 -validity 10950 \
  -storepass "${KS_PASS}" -keypass "${KS_PASS}" \
  -dname "CN=${STORE_NAME:-Ruba Pharmacy}, OU=Ruba Pharmacy Team, O=Ruba Pharmacy, L=Riyadh, C=SA"

echo
echo "✅ تم التوليد: ${KS_FILE}"
echo "── بصمة SHA-256 (ستحتاجها لـ assetlinks.json):"
keytool -list -v -keystore "${KS_FILE}" -alias ruba-upload -storepass "${KS_PASS}" \
  | grep "SHA256:"
echo
echo "📌 احفظ: مسار الملف + كلمة المرور + الاسم المستعار ruba-upload"
