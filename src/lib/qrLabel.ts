// ============================================================================
// Kalta – Brother PT-P710BT QR label HTML template
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
import { BrotherPrinterSDK } from 'expo-brother-printer-sdk';
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
  const TEXT_AREA_WIDTH_MM = 52; // 80 − 2×2 padding − 20 QR − 4 gap
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
  // Error correction level M = 15% damage tolerance. No logo overlay in
  // the printed QR — logo lives only in the in-app screen views where
  // resolution is high. Fewer ECC codewords = fewer modules = bigger
  // individual modules on the 20mm physical print = better scan reliability
  // from phone cameras at arm's length.
  const svg = await QRCode.toString(box.qr_code, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
  });

  const name = escapeHtml(box.name);
  const location = box.location ? escapeHtml(box.location) : null;
  const nameFontSize = computeNameFontSize(box.name, !!box.location);

  // Layout strategy:
  // - PDF page is **portrait** (68 × 227 pt ≈ 24 × 80 mm) because
  //   Brother's SDK treats PDF width as the physical tape width. If
  //   we fed it a landscape PDF it would scale the 80 mm width down
  //   to 24 mm tape and everything would come out miniature.
  // - `.label` inside is still designed **horizontally** (QR + text
  //   side by side at 227 × 68 pt) and then rotated 90° via CSS so
  //   the rendered PDF pixels match the portrait page while the
  //   intended visual layout is preserved.
  // - `overflow: hidden` on html/body clips any stray overflow.
  // - 2mm padding leaves room for Brother TZe tape's physical print margin.
  // - QR 18mm square with absolutely-positioned 7.5mm rounded logo
  //   tile in the center, sitting within ECC-H 30% damage tolerance.
  // - Name font size is computed dynamically based on character count so
  //   short names ("Home") fill the available width while long names
  //   shrink to fit, with text-overflow: ellipsis as the ultimate safety.
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <style>
    @page { size: ${TAPE_WIDTH_PT}pt ${LABEL_LENGTH_PT}pt; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${TAPE_WIDTH_PT}pt;
      height: ${LABEL_LENGTH_PT}pt;
      max-height: ${LABEL_LENGTH_PT}pt;
      overflow: hidden;
      font-family: -apple-system, "Helvetica Neue", Helvetica, sans-serif;
      color: #000;
      background: #fff;
      /* Prevent WebView from adding a second page when .label is
         absolute-positioned (out of flow → body sees zero content
         height → some renderers insert a blank trailing page). */
      page-break-after: avoid;
    }
    .label {
      /* Designed horizontally at landscape dimensions, then rotated 90°
         so it fills the portrait page. Absolute + translate(-50%) + rotate
         around center places a 227×68 box inside a 68×227 page exactly. */
      position: absolute;
      top: 50%;
      left: 50%;
      width: ${LABEL_LENGTH_PT}pt;
      height: ${TAPE_WIDTH_PT}pt;
      transform: translate(-50%, -50%) rotate(90deg);
      transform-origin: center;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 4mm;
      padding: 2mm;
    }
    .qr {
      position: relative;
      flex-shrink: 0;
      width: 20mm;
      height: 20mm;
    }
    .qr svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    /* No logo overlay on printed label — at 20mm physical QR on 180 DPI
       thermal tape, every module counts for scan reliability. Logo lives
       only in the in-app screen views where resolution is unlimited. */
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
    <div class="qr">${svg}</div>
    <div class="text">
      <div class="name" style="font-size: ${nameFontSize}mm">${name}</div>
      ${location ? `<div class="loc">${location}</div>` : ''}
    </div>
  </div>
</body>
</html>`;
}

// PDF dimensions for a PT-P710BT label. Brother SDK reads the PDF's
// **width** as the tape width dimension, so PDFs must be generated in
// "portrait" (width = 24 mm TZe tape, height = strip length along feed).
// Content inside is rotated 90° via CSS so the visual layout still reads
// horizontally (QR on one end, name on the other) once the tape comes
// out of the printer.
//
// 1 pt = 1/72 inch; 1 inch = 25.4 mm.
const TAPE_WIDTH_PT = Math.round((24 / 25.4) * 72); // ≈ 68 — tape width
const LABEL_LENGTH_PT = Math.round((80 / 25.4) * 72); // ≈ 227 — strip length

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
    height: LABEL_LENGTH_PT,
    base64: false,
  });
  await Print.printAsync({ uri });
}

/**
 * Direct print to a Brother P-touch Bluetooth printer (PT-P710BT) via
 * Brother's Mobile SDK, bypassing the iOS system print dialog entirely.
 * The dialog can't see Bluetooth-only printers — it scans AirPrint over
 * Bonjour/WiFi — and Brother's consumer iOS apps refuse any external file
 * input. This path is the only one that actually works for that hardware.
 *
 * Flow:
 *   1. Generate the label PDF at 80×24 mm (shared with `printBoxLabel`).
 *   2. Scan Bluetooth for Brother channels. Printer must be paired in
 *      iOS Settings → Bluetooth (MFi pairing), not via Brother's own app.
 *   3. Pick the first PT-series channel (or match model prefix when more
 *      than one Brother is paired).
 *   4. Send PDF over Bluetooth using `BrotherPrinterSDK.printPDF` with
 *      PT-specific settings (24 mm TZe tape, auto-cut on).
 *
 * The underlying Expo module only supported QL series until we patched
 * it (see `patches/expo-brother-printer-sdk+0.7.0.patch`) — the patch
 * adds PT-P710BT to the model map and teaches SettingsUtils to return
 * a `BRLMPTPrintSettings` for PT-prefixed model names.
 */
// PT series label size enum value for 24 mm TZe tape. Mirrors
// `BRLMPTPrintSettingsLabelSizeWidth24mm = 5` in the Brother SDK header.
const PT_LABEL_SIZE_24MM = 5;

export async function printBoxLabelViaBrotherSDK(
  box: Pick<Box, 'name' | 'qr_code' | 'location'>,
): Promise<void> {
  // 1. Render PDF once (same pipeline used by the AirPrint fallback).
  const html = await buildLabelHtml(box);
  const { uri } = await Print.printToFileAsync({
    html,
    width: TAPE_WIDTH_PT,
    height: LABEL_LENGTH_PT,
    base64: false,
  });

  // 2. Look for paired Brother printers over Bluetooth.
  const channels = await BrotherPrinterSDK.searchBluetoothPrinters();
  if (channels.length === 0) {
    throw new Error(
      'No Brother printer found. Pair PT-P710BT in iOS Settings → Bluetooth first.',
    );
  }

  // 3. Pick a PT-series channel. Prefer the first PT printer; falls back
  //    to the first channel found so the error message below makes sense
  //    when the user has some other unsupported Brother model paired.
  const ptChannel =
    channels.find((c) => c.modelName?.startsWith('PT-')) ?? channels[0];
  if (!ptChannel.modelName?.startsWith('PT-')) {
    throw new Error(
      `Found Brother "${ptChannel.modelName ?? 'unknown'}" but this flow only supports PT-series (P-touch) printers.`,
    );
  }

  // 4. Fire the print job. Settings are tuned for 24 mm TZe tape on
  //    PT-P710BT — auto-cut on, chain-print off, normal resolution.
  await BrotherPrinterSDK.printPDF(uri, ptChannel, {
    labelSize: PT_LABEL_SIZE_24MM as any,
    autoCut: true,
    autoCutForEachPageCount: 1,
  } as any);
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
    height: LABEL_LENGTH_PT,
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
