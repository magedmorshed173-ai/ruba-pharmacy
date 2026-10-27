#!/usr/bin/env node
/**
 * نسخ أصول standalone — v4.6.6
 * بديل عابر المنصات لأمر `cp -r` في سكربت البناء (يفشل على cmd.exe/PowerShell):
 *   1) .next/static  → .next/standalone/.next/static
 *   2) public/       → .next/standalone/public
 * يعمل على Node 16.7+ (fs.cpSync) وBun على كل المنصات (Linux/Termux/macOS/Windows).
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const staticSrc = join(root, ".next", "static");
const staticDst = join(standalone, ".next", "static");
const publicSrc = join(root, "public");
const publicDst = join(standalone, "public");

if (!existsSync(standalone)) {
  console.error("✗ .next/standalone غير موجود — شغّل next build أولاً");
  process.exit(1);
}

for (const [src, dst, label] of [
  [staticSrc, staticDst, "static → standalone/.next/static"],
  [publicSrc, publicDst, "public → standalone/public"],
]) {
  if (!existsSync(src)) {
    console.warn(`⚠ ${src} غير موجود — تخطّي`);
    continue;
  }
  cpSync(src, dst, { recursive: true, force: true });
  console.log(`✓ ${label}`);
}

console.log("✓ أصول standalone مكتملة");
