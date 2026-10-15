/**
 * Generates every PWA / iOS icon the WordPress plugin ships.
 *
 * iOS never accepts SVG (and can be unreliable with WebP) for
 * `apple-touch-icon`, so the plugin needs real PNGs in all the sizes Apple
 * looks for, plus the Android/desktop manifest sizes and a maskable variant.
 *
 *   node scripts/generate-icons.js   (ou: npm run icons)
 *
 * The brand glyph is the same "scan-box" mark used by the plugin header.
 * Output: wordpress-plugin/v-dicom/icon/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "wordpress-plugin", "v-dicom", "icon");

// App icon palette: black background, white glyph.
const BG_TOP = "#000000";
const BG_BOTTOM = "#000000";
const GLYPH = "#ffffff";

// Inner markup of the lucide "scan-box" glyph (viewBox 0 0 24 24).
const GLYPH_PATHS = [
  '<path d="M12 12v5.5"/>',
  '<path d="M17 3h2a2 2 0 012 2v2"/>',
  '<path d="M21 17v2a2 2 0 01-2 2h-2"/>',
  '<path d="M3 7V5a2 2 0 012-2h2"/>',
  '<path d="M7 21H5a2 2 0 01-2-2v-2"/>',
  '<path d="M7.264 9.252 12 12l4.737-2.748"/>',
  '<path d="M7.995 8.514A2 2 0 007 10.244v3.516a2 2 0 00.996 1.73l3 1.74a2 2 0 002.008 0l3-1.74A2 2 0 0017 13.76v-3.517a2 2 0 00-.995-1.73l-3-1.742a2 2 0 00-1.892-.064z"/>',
].join("");

function buildSvg(size, { scale = 0.62, radius = 0 } = {}) {
  const glyphPx = scale * size;
  const offset = (size - glyphPx) / 2;
  const s = glyphPx / 24;
  const rx = radius ? (radius * size).toFixed(2) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#bg)"/>
  <g transform="translate(${offset.toFixed(3)},${offset.toFixed(3)}) scale(${s.toFixed(3)})"
     fill="none" stroke="${GLYPH}" stroke-width="1.9"
     stroke-linecap="round" stroke-linejoin="round">${GLYPH_PATHS}</g>
</svg>`;
}

async function renderPng(file, size, opts) {
  const buf = await sharp(Buffer.from(buildSvg(size, opts)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(outDir, file), buf);
  console.log(`  ${file} (${size}x${size})`);
}

/**
 * Minimal ICO container. Each entry stores a PNG payload, which current
 * browsers and Windows accept for 16-48px sizes.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = Buffer.alloc(entries.length * 16);
  entries.forEach((entry, i) => {
    const b = i * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, b);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, b + 1);
    dir.writeUInt8(0, b + 2);
    dir.writeUInt8(0, b + 3);
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(entry.data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

async function renderIcoPng(size) {
  return sharp(Buffer.from(buildSvg(size, { scale: 0.68 })))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const APPLE_SIZES = [120, 152, 167, 180];
const MANIFEST_SIZES = [192, 512];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Gerando icones em ${path.relative(root, outDir)}`);

  for (const size of APPLE_SIZES) {
    await renderPng(`apple-touch-icon-${size}x${size}.png`, size, { scale: 0.62 });
  }

  for (const size of MANIFEST_SIZES) {
    await renderPng(`icon-${size}x${size}.png`, size, { scale: 0.62 });
  }

  // Maskable: the glyph must survive a circular crop, so keep it well inside
  // the 80% safe zone (scale ~0.42 of the canvas).
  await renderPng("maskable-512x512.png", 512, { scale: 0.42 });

  await renderPng("favicon-32x32.png", 32, { scale: 0.72 });

  const icoEntries = [];
  for (const size of [16, 32, 48]) {
    icoEntries.push({ size, data: await renderIcoPng(size) });
  }
  fs.writeFileSync(path.join(outDir, "favicon.ico"), buildIco(icoEntries));
  console.log("  favicon.ico (16, 32, 48)");
}

main().catch((err) => {
  console.error("Falha ao gerar icones:", err.message || err);
  process.exitCode = 1;
});
