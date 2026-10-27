# ============================================================================
# صيدلية رُبى — مثبّت ويندوز v4.6.6
# التشغيل (PowerShell):  irm https://raw.githubusercontent.com/magedmorshed173-ai/ruba-pharmacy/main/scripts/install.ps1 | iex
# أو بعد التنزيل:        powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Docker] [-Port 3000]
# يتطلب: Windows 10+ مع winget (مدمج) — ويعمل بثلاثة مسارات: Docker / Bun / Node.js
# الأمان: القيم الحساسة تُقرأ مخفية ولا تُطبع، وتُكتب في .env محلي (بلا نشر)
# ============================================================================
param(
  [switch]$Docker,
  [string]$Dir = "$HOME\ruba-pharmacy",
  [int]$Port = 3000
)
$ErrorActionPreference = "Stop"
$Repo = "https://github.com/magedmorshed173-ai/ruba-pharmacy.git"

function Say($m) { Write-Host "▸ $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m){ Write-Host "⚠ $m" -ForegroundColor Yellow }
function ReadHidden($prompt) {
  $sec = Read-Host $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

Write-Host "════════════════════════════════════════════" -ForegroundColor DarkCyan
Say "صيدلية رُبى — تثبيت v4.6.6 (ويندوز)"
Write-Host "════════════════════════════════════════════" -ForegroundColor DarkCyan

# ── git ──
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Say "تثبيت Git عبر winget…"
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
}

# ── مجلد التطبيق ──
if (-not (Test-Path "$Dir\package.json")) {
  Say "نسخ المشروع إلى $Dir …"
  git clone --depth 1 $Repo $Dir
}
Set-Location $Dir

# ── المسار 1: Docker ──
if ($Docker -or (Get-Command docker -ErrorAction SilentlyContinue)) {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    if (-not (Test-Path .env)) {
      $bytes = New-Object byte[] 32
      [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
      $auth = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
      "AUTH_SECRET=`"$auth`"" | Set-Content .env -Encoding utf8
      Ok "كُتب .env مع AUTH_SECRET مولَّد"
    }
    Say "تشغيل Docker Compose (بناء + قاعدة محلية + ترحيلات)…"
    docker compose up -d --build
    Ok "الواجهة: http://localhost:3000  — السجلات: docker compose logs -f ruba-pharmacy"
    Start-Process "http://localhost:3000"
    exit 0
  }
  Warn "طلب Docker لكنه غير مثبّت — سنكمل بمسار Node/Bun (ثبّت Docker Desktop لاحقاً إن رغبت)"
}

# ── بيئة التشغيل: Bun إن أمكن وإلا Node.js ──
$runtime = ""
if (Get-Command bun -ErrorAction SilentlyContinue) { $runtime = "bun" }
if (-not $runtime) {
  Say "تثبيت Bun (يدعم ويندوز أصلياً منذ 1.1)…"
  npm install -g bun 2>$null
  if (Get-Command bun -ErrorAction SilentlyContinue) { $runtime = "bun" }
}
if (-not $runtime) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say "تثبيت Node.js LTS عبر winget…"
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    # تحديث PATH في هذه الجلسة
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
  }
  $runtime = "node"
}
Ok "بيئة التشغيل: $runtime"

# ── الاعتماديات ──
if ($runtime -eq "bun") { bun install --frozen-lockfile } else { npm install --no-audit --no-fund }

# ── قاعدة البيانات ──
if (-not (Test-Path .env)) {
  Say "إعداد الاتصال بقاعدة البيانات:"
  Write-Host "  (أ) Neon سحابية — الصق السلسلة المجمّعة (pooled) من Vercel → Storage → Neon"
  Write-Host "  (ب) محلية — docker run -d --name ruba-db -e POSTGRES_PASSWORD=ruba_local -e POSTGRES_DB=ruba -p 5432:5432 postgres:16-alpine"
  $choice = Read-Host "اختر (a/b)"
  $dbUrl = ReadHidden "DATABASE_URL (الإدخال مخفي)"
  if ($dbUrl -notlike "postgresql://*") { throw "السلسلة يجب أن تبدأ بـ postgresql://" }
  $direct = $dbUrl -replace "-pooler\.", "."
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $auth = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
  @"
DATABASE_URL="$dbUrl"
DIRECT_URL="$direct"
AUTH_SECRET="$auth"
"@ | Set-Content .env -Encoding utf8
  Ok "كُتب .env (القيم لن تُطبع)"
}

# ── الترحيلات ──
Say "تطبيق الترحيلات (prisma migrate deploy)…"
if ($runtime -eq "bun") { bunx prisma migrate deploy } else { npx -y prisma migrate deploy }

# ── البناء ──
Say "بناء نسخة الإنتاج…"
if ($runtime -eq "bun") { bun run build } else { npm run build }
Ok "اكتمل البناء (سكربت النسخ عابر المنصات — بلا cp)"

# ── التشغيل ──
Say "تشغيل الخادم على المنفذ $Port …"
$env:PORT = $Port; $env:NODE_ENV = "production"
Start-Process -WindowStyle Hidden node -ArgumentList ".next\standalone\server.js" -RedirectStandardOutput "server.log" -RedirectStandardError "server.err.log"
Start-Sleep -Seconds 3
Ok "اكتمل التثبيت — صيدلية رُبى v4.6.6"
Write-Host "   محلياً:  http://localhost:$Port"
Write-Host "   تثبيت كتطبيق: افتح الرابط في Chrome/Edge ← «تثبيت التطبيق» (PWA)"
Start-Process "http://localhost:$Port"
