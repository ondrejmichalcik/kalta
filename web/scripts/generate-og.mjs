#!/usr/bin/env node
// Generates public/og-image.png (1200x630) by compositing the Kalta box
// icon on a sage-green gradient background with the tagline.
// Run once after design changes: `node scripts/generate-og.mjs`

import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const W = 1200;
const H = 630;

const bgSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#eaf1ea"/>
      <stop offset="100%" stop-color="#c9dbc9"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#5f7c5f"/>
      <stop offset="100%" stop-color="#7a9e7a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <!-- Decorative circle -->
  <circle cx="${W - 80}" cy="${H - 80}" r="260" fill="url(#accent)" opacity="0.08"/>
  <circle cx="80" cy="80" r="180" fill="url(#accent)" opacity="0.05"/>
</svg>
`;

const textSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>
    .title {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      font-weight: 700;
      font-size: 76px;
      fill: #1a211a;
      letter-spacing: -0.03em;
    }
    .tagline {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      font-weight: 400;
      font-size: 30px;
      fill: #5c665c;
    }
    .brand {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      font-weight: 600;
      font-size: 28px;
      fill: #5f7c5f;
      letter-spacing: 0.02em;
    }
  </style>
  <text x="72" y="110" class="brand">KALTA</text>
  <text x="72" y="300" class="title">Never forget</text>
  <text x="72" y="390" class="title">what you stocked up on.</text>
  <text x="72" y="470" class="tagline">Home emergency stock tracker for iOS</text>
</svg>
`;

async function main() {
  const boxPath = join(root, 'public/box.png');
  const outPath = join(root, 'public/og-image.png');

  const boxBuffer = await sharp(boxPath)
    .resize(440, 440, { fit: 'contain' })
    .toBuffer();

  await sharp(Buffer.from(bgSvg))
    .composite([
      { input: Buffer.from(textSvg), top: 0, left: 0 },
      { input: boxBuffer, top: 95, left: W - 440 - 80 },
    ])
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(outPath);

  console.log(`✓ Generated ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
