// ============================================================================
// Stockr – Offline image cache
// Downloads product images from Supabase Storage to device filesystem so
// they're available without network. Cache lives in documentDirectory and
// persists across app launches.
//
// Naming: SHA-256 hash of the URL → {hash}.jpg. Deterministic, no duplicates.
// ============================================================================
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { getDb } from './localDb';
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

const CACHE_DIR = `${documentDirectory}image-cache/`;

// In-memory lookup: URL → local file URI. Populated on app start by scanning
// the cache directory and on each new cache write.
const _cache = new Map<string, string>();
let _initialized = false;

/**
 * Hash a URL to a deterministic filename.
 */
async function hashUrl(url: string): Promise<string> {
  const hex = await digestStringAsync(CryptoDigestAlgorithm.SHA256, url);
  return hex.slice(0, 32);
}

/**
 * Ensure the cache directory exists. Idempotent.
 */
async function ensureDir(): Promise<void> {
  const info = await getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/**
 * Initialize the in-memory cache map by scanning existing cached files.
 * Called once on first access. Maps stored metadata back to URL→path.
 */
export async function initImageCache(): Promise<void> {
  if (_initialized) return;
  try {
    await ensureDir();
    // We store a small .meta sidecar with the original URL so we can
    // rebuild the in-memory map on restart without re-hashing all URLs.
    const files = await readDirectoryAsync(CACHE_DIR);
    for (const f of files) {
      if (!f.endsWith('.meta')) continue;
      try {
        const url = await readAsStringAsync(CACHE_DIR + f);
        const imgFile = f.replace('.meta', '.jpg');
        const imgPath = CACHE_DIR + imgFile;
        const imgInfo = await getInfoAsync(imgPath);
        if (imgInfo.exists && url) {
          _cache.set(url, imgPath);
        }
      } catch { /* skip corrupt meta */ }
    }
  } catch { /* first run, dir doesn't exist yet */ }
  _initialized = true;
}

/**
 * Get the local cached URI for a remote image URL.
 * Returns the local path if cached, otherwise the original URL.
 * This is synchronous for use in render — call `initImageCache()` on startup.
 */
export function getCachedUri(url: string | null): string | null {
  if (!url) return null;
  return _cache.get(url) ?? url;
}

/**
 * Check if a URL is already cached locally.
 */
export function isCached(url: string): boolean {
  return _cache.has(url);
}

/**
 * Download a remote image and store it in the cache.
 * No-op if already cached. Returns the local file URI.
 */
export async function cacheImage(url: string): Promise<string> {
  if (_cache.has(url)) return _cache.get(url)!;

  await ensureDir();
  const hash = await hashUrl(url);
  const localPath = `${CACHE_DIR}${hash}.jpg`;
  const metaPath = `${CACHE_DIR}${hash}.meta`;

  // Check if file exists on disk (race condition guard)
  const info = await getInfoAsync(localPath);
  if (info.exists) {
    _cache.set(url, localPath);
    return localPath;
  }

  const download = await downloadAsync(url, localPath);
  if (download.status !== 200) {
    // Clean up partial download
    try { await deleteAsync(localPath, { idempotent: true }); } catch {}
    throw new Error(`Image download failed: ${download.status}`);
  }

  // Write meta sidecar so we can rebuild the map on restart
  await writeAsStringAsync(metaPath, url);
  _cache.set(url, localPath);
  return localPath;
}

/**
 * Cache a local file (e.g. just-uploaded image) under the given remote URL.
 * Copies the file into the cache so it's available immediately without
 * needing to download from Supabase.
 */
export async function cacheImageFromLocal(
  remoteUrl: string,
  localUri: string,
): Promise<string> {
  await ensureDir();
  const hash = await hashUrl(remoteUrl);
  const cachedPath = `${CACHE_DIR}${hash}.jpg`;
  const metaPath = `${CACHE_DIR}${hash}.meta`;

  await copyAsync({ from: localUri, to: cachedPath });
  await writeAsStringAsync(metaPath, remoteUrl);
  _cache.set(remoteUrl, cachedPath);
  return cachedPath;
}

/**
 * Remove a cached image by its remote URL. Called when an item's image
 * is deleted or replaced.
 */
export async function removeCachedImage(url: string): Promise<void> {
  const hash = await hashUrl(url);
  const localPath = `${CACHE_DIR}${hash}.jpg`;
  const metaPath = `${CACHE_DIR}${hash}.meta`;
  try {
    await deleteAsync(localPath, { idempotent: true });
    await deleteAsync(metaPath, { idempotent: true });
  } catch { /* ignore */ }
  _cache.delete(url);
}

/**
 * Remove cached images that are no longer referenced by any item or
 * custom_product in the local database. Frees disk space from deleted
 * or replaced images. Safe to call periodically (e.g. on app start).
 */
export async function cleanupOrphanedCache(): Promise<number> {
  if (!_initialized) return 0;

  // Collect all image_url values currently in use
  const db = getDb();
  const itemUrls = db.getAllSync<{ image_url: string }>(
    'SELECT image_url FROM items WHERE image_url IS NOT NULL AND _deleted_at IS NULL',
  ).map((r) => r.image_url);
  const productUrls = db.getAllSync<{ image_url: string }>(
    'SELECT image_url FROM custom_products WHERE image_url IS NOT NULL AND _deleted_at IS NULL',
  ).map((r) => r.image_url);
  const activeUrls = new Set([...itemUrls, ...productUrls]);

  // Find cached URLs that are no longer referenced
  let removed = 0;
  for (const [url, localPath] of _cache.entries()) {
    if (!activeUrls.has(url)) {
      try {
        const hash = await hashUrl(url);
        await deleteAsync(localPath, { idempotent: true });
        await deleteAsync(`${CACHE_DIR}${hash}.meta`, { idempotent: true });
      } catch { /* ignore */ }
      _cache.delete(url);
      removed++;
    }
  }

  return removed;
}

/**
 * Prefetch multiple image URLs in parallel. Used after sync pull to
 * download newly discovered images. Errors are silently skipped per image.
 */
export async function prefetchImages(urls: string[]): Promise<void> {
  const uncached = urls.filter((u) => u && !_cache.has(u));
  if (uncached.length === 0) return;

  // Download in batches of 4 to avoid flooding the network
  const BATCH = 4;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    await Promise.allSettled(batch.map((url) => cacheImage(url)));
  }
}
