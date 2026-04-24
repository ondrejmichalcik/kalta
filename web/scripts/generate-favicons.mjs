#!/usr/bin/env node
// Generates favicon PNG variants at every size from the master app icon,
// plus favicon.ico (multi-size) and favicon.svg (SVG wrapper around the PNG
// so modern browsers that prefer SVG still show the detailed app icon).
// Run: `npm run favicons`.

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repoRoot = join(root, '..');

async function main() {
  const appIconSrc = join(repoRoot, 'assets/icon.png');

  const sizes = [
    { size: 16, name: 'favicon-16.png' },
    { size: 32, name: 'favicon-32.png' },
    { size: 48, name: 'favicon-48.png' },
    { size: 96, name: 'favicon-96.png' },
    { size: 180, name: 'apple-touch-icon.png' },
    { size: 192, name: 'android-chrome-192.png' },
    { size: 512, name: 'android-chrome-512.png' },
  ];

  for (const { size, name } of sizes) {
    await sharp(appIconSrc)
      .resize(size, size, { fit: 'contain', kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toFile(join(root, `public/${name}`));
  }

  // favicon.ico — multi-size ICO (16, 32, 48)
  const icoSizes = [16, 32, 48];
  const icoBuffers = await Promise.all(
    icoSizes.map((s) =>
      sharp(appIconSrc)
        .resize(s, s, { fit: 'contain', kernel: 'lanczos3' })
        .png()
        .toBuffer(),
    ),
  );
  const icoData = await pngToIco(icoBuffers);
  await writeFile(join(root, 'public/favicon.ico'), icoData);

  // favicon.svg — minimal SVG wrapper that embeds the 192px PNG. Browsers that
  // prefer SVG favicons (Chrome, Firefox) will fetch this, render the PNG
  // inside it, and get the detailed app icon look at any pixel density.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 192 192"><image xlink:href="/android-chrome-192.png" width="192" height="192"/></svg>`;
  await writeFile(join(root, 'public/favicon.svg'), svg);

  // Small 64px for header logo
  await sharp(appIconSrc)
    .resize(64, 64, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(join(root, 'public/app-icon.png'));

  console.log('✓ Generated favicon variants (PNG, ICO, SVG) from app icon');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
