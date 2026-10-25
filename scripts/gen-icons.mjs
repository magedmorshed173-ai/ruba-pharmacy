/**
 * توليد أيقونات PWA / Google Play من الشعار المصدري
 * Generate PWA / Play-Store icons from the source SVG.
 * Usage: node scripts/gen-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "public/icon.svg";
mkdirSync("public", { recursive: true });

const jobs = [
  { file: "public/pwa-192.png", size: 192, pad: 0 },
  { file: "public/pwa-512.png", size: 512, pad: 0 },
  // maskable: keep artwork inside ~78% safe zone over solid brand background
  { file: "public/maskable-192.png", size: 192, pad: 0.11 },
  { file: "public/maskable-512.png", size: 512, pad: 0.11 },
  { file: "public/apple-touch-icon.png", size: 180, pad: 0 },
];

for (const job of jobs) {
  const inner = Math.round(job.size * (1 - job.pad * 2));
  const canvas = sharp({
    create: {
      width: job.size,
      height: job.size,
      channels: 4,
      background: { r: 13, g: 148, b: 136, alpha: 1 }, // #0D9488 brand teal
    },
  });
  const art = await sharp(SRC)
    .resize(inner, inner)
    .png()
    .toBuffer();
  await canvas
    .composite([{ input: art, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(job.file);
  console.log("✓", job.file);
}
console.log("All PWA icons generated.");
