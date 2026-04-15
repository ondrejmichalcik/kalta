// ============================================================================
// Stockr – Brother PT-P710BT QR label HTML template
// Generates a print-ready HTML string for `expo-print` that renders a
// single 24 mm TZe tape label: QR code on the left, box name + optional
// location on the right. Layout is horizontal (short tape run) and uses
// absolute mm units so AirPrint scales it reasonably regardless of the
// printer the user picks in the dialog.
//
// Phase 1 (hardware-independent): this file + expo-print integration. The
// Brother PT-P710BT exposes itself as an AirPrint printer, so no BLE /
// SDK work is needed — we just hand iOS an HTML page sized to 24 mm tape.
// ============================================================================
import QRCode from 'qrcode';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
// Legacy FS entry: the v19+ top-level API has moved to the `new File()`
// class, but it doesn't expose a base64 read. `expo-file-system/legacy`
// still ships `readAsStringAsync({ encoding: 'base64' })` for this exact
// "read bundled asset → inline data URI" pattern.
import { readAsStringAsync } from 'expo-file-system/legacy';
import type { Box } from '@/src/types/database';

// Module-level cache: the bundled logo is identical for every label, so
// we decode it once on first print and reuse the data URI forever after.
let cachedLogoDataUri: string | null = null;

async function loadLogoDataUri(): Promise<string | null> {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    const asset = Asset.fromModule(require('@/assets/label-logo.png'));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
    cachedLogoDataUri = `data:image/png;base64,${base64}`;
    return cachedLogoDataUri;
  } catch {
    // If asset loading fails for any reason, fall back to a logo-less QR
    // rather than breaking the print flow entirely.
    return null;
  }
}

/** Minimal HTML-escape for user-provided strings embedded in the template. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Heuristic: pick a font size (mm) for the box name that fills the
 * available text area without overflowing horizontally. Works on a rough
 * average char width for bold sans-serif (~0.62 × font-size — slightly
 * conservative to bias toward "definitely fits" over "borderline"). The
 * floor is set low (2mm) so very long names still squeeze in at a
 * microscopic-but-readable size rather than getting ellipsized. Height
 * cap depends on whether a subtitle (location) steals vertical space.
 * If a name really is too long even at 2mm, CSS `text-overflow: ellipsis`
 * is the final safety net.
 */
function computeNameFontSize(name: string, hasLocation: boolean): number {
  const TEXT_AREA_WIDTH_MM = 54; // 80 − 2×2 padding − 18 QR − 4 gap
  const CHAR_WIDTH_RATIO = 0.62;
  const widthCap = TEXT_AREA_WIDTH_MM / (Math.max(1, name.length) * CHAR_WIDTH_RATIO);
  const heightCap = hasLocation ? 9 : 13;
  const MIN = 2;
  const MAX = 10;
  const raw = Math.min(widthCap, heightCap, MAX);
  return Math.max(MIN, Math.round(raw * 10) / 10);
}

/**
 * Build the HTML body for one label. Uses a flex row: QR tile (18 mm
 * square, flex-shrink: 0) on the left, name + optional location stacked
 * on the right taking the remaining width. Tape is 24 mm wide — we
 * reserve 3 mm top/bottom as a safety margin so the content sits
 * within the printable area.
 *
 * Tape length (`@page size 80mm auto`) starts at 80mm so short names
 * don't need to span an awkwardly short strip; AirPrint will cut at
 * the content edge when sending to a tape printer.
 */
export async function buildLabelHtml(
  box: Pick<Box, 'name' | 'qr_code' | 'location'>,
): Promise<string> {
  // Error correction level H = 30% damage tolerance. Required so we can
  // overlay a Stockr logo in the QR center and still scan reliably.
  const svg = await QRCode.toString(box.qr_code, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'H',
  });

  const name = escapeHtml(box.name);
  const location = box.location ? escapeHtml(box.location) : null;
  const nameFontSize = computeNameFontSize(box.name, !!box.location);
  const logoDataUri = await loadLogoDataUri();

  // Layout strategy:
  // - `@page size` matches the pt dimensions passed to printToFileAsync
  //   (227 × 68 pt ≈ 80 × 24 mm tape label).
  // - body fills the page at 100% width/height — no fixed pt values, so
  //   rounding between WebView CSS px and PDF pt can't tip us into a
  //   second page.
  // - `overflow: hidden` on html/body clips any stray overflow instead
  //   of spilling to page 2.
  // - 2mm padding leaves room for Brother TZe tape's physical print margin.
  // - QR 18mm square with absolutely-positioned 4mm logo tile in the center,
  //   sitting within the ECC-H 30% damage tolerance.
  // - Name font size is computed dynamically based on character count so
  //   short names ("Home") fill the available width while long names
  //   shrink to fit, with text-overflow: ellipsis as the ultimate safety.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <style>
    @page { size: 227pt 68pt; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, "Helvetica Neue", Helvetica, sans-serif;
      color: #000;
      background: #fff;
    }
    .label {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 4mm;
      width: 100%;
      height: 100%;
      padding: 2mm;
    }
    .qr {
      position: relative;
      flex-shrink: 0;
      width: 18mm;
      height: 18mm;
    }
    .qr svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    /* 7.5mm square overlay — ~42% of QR width, ~17% of QR area. Comfortable
       safety margin under the ECC-H 30% area tolerance so the QR scans
       reliably from various angles/distances. White background is baked
       into the PNG, a hairline border visually separates the logo from
       the surrounding QR modules. */
    .qr-logo {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 7.5mm;
      height: 7.5mm;
      transform: translate(-50%, -50%);
      border-radius: 1mm;
      background: #fff;
      display: block;
      overflow: hidden;
    }
    .qr-logo img {
      width: 100%;
      height: 100%;
      display: block;
    }
    .text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-align: center;
    }
    .name {
      font-weight: 800;
      line-height: 1;
      letter-spacing: -0.1mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .loc {
      font-size: 2.8mm;
      color: #555;
      margin-top: 1mm;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="qr">
      ${svg}
      ${logoDataUri ? `<div class="qr-logo"><img src="${logoDataUri}" alt="" /></div>` : ''}
    </div>
    <div class="text">
      <div class="name" style="font-size: ${nameFontSize}mm">${name}</div>
      ${location ? `<div class="loc">${location}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
}

// 24 mm TZe tape width × 80 mm strip length, converted to PostScript points
// (1 pt = 1/72 inch; 1 inch = 25.4 mm). iOS `Print.printAsync` uses these
// to size the print job — CSS `@page` alone is ignored when passing raw
// HTML, so without these the dialog falls back to A4/Letter.
const TAPE_WIDTH_PT = Math.round((80 / 25.4) * 72); // ≈ 227
const TAPE_HEIGHT_PT = Math.round((24 / 25.4) * 72); // ≈ 68

/**
 * Print a box QR label via the iOS system print dialog. Two-step:
 *   1. `printToFileAsync` renders HTML into a PDF at exact tape dimensions.
 *      This is the only reliable way to get iOS to honour our page size —
 *      passing HTML directly to `printAsync` lets UIKit pick A4/Letter.
 *   2. `printAsync` with the PDF URI forwards the pre-sized document to
 *      AirPrint. The iOS dialog opens with the correct paper size baked
 *      into the PDF.
 *
 * Errors (including user-cancel from the dialog) are re-thrown for the
 * caller to handle — `box/[boxId].tsx` and `box/new.tsx` swallow the
 * "did not complete" cancel message and surface the rest as alerts.
 */
export async function printBoxLabel(
  box: Pick<Box, 'name' | 'qr_code' | 'location'>,
): Promise<void> {
  const html = await buildLabelHtml(box);
  const { uri } = await Print.printToFileAsync({
    html,
    width: TAPE_WIDTH_PT,
    height: TAPE_HEIGHT_PT,
    base64: false,
  });
  await Print.printAsync({ uri });
}

/**
 * Generate the label PDF and hand it to the iOS share sheet — user can
 * save it to Files / send via Messages / AirDrop to a Mac. Used both as
 * a debugging helper (verify PDF metadata in Preview) and as a fallback
 * print path when the Brother AirPrint flow isn't available.
 */
export async function shareBoxLabelPdf(
  box: Pick<Box, 'name' | 'qr_code' | 'location'>,
): Promise<void> {
  const html = await buildLabelHtml(box);
  const { uri } = await Print.printToFileAsync({
    html,
    width: TAPE_WIDTH_PT,
    height: TAPE_HEIGHT_PT,
    base64: false,
  });
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `Label — ${box.name}`,
  });
}
