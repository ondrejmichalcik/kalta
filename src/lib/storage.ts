// ============================================================================
// Kalta – Storage helpers
// Upload / delete product images on the Supabase `product-images` bucket.
// ============================================================================
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import { cacheImageFromLocal, removeCachedImage } from './imageCache';
import { getDb } from './localDb';
import { isCloudEnabledNow } from './subscription';

const BUCKET = 'product-images';

/**
 * URI scheme for images captured while the user's subscription was
 * lapsed. The file is cached locally; the row stores this synthetic URI
 * in `image_url` so the UI can render it via imageCache. On the next
 * cloud-enabled sync, `flushDeferredImageUploads()` replaces the URI
 * with the real Supabase Storage public URL.
 */
const DEFERRED_URI_PREFIX = 'local:';

export function isDeferredImageUri(url: string | null | undefined): boolean {
  return !!url && url.startsWith(DEFERRED_URI_PREFIX);
}

// Resize target: items in lists render at 28–36 px and item edit sheets
// show photos at ~120 px. 480 px wide gives crisp 2× retina on all those
// surfaces while landing around 30–60 KB per file — roughly 3× smaller
// than the previous 800 px @ 70 % preset, which keeps Supabase Storage
// budget viable up to a few hundred active users.
const RESIZE_WIDTH = 480;
const JPEG_QUALITY = 0.6; // 0..1, ImageManipulator scale

/**
 * Resize + compress a local image URI, upload it to the `product-images`
 * bucket under `{warehouseId}/{timestamp}-{random}.jpg`, and return the
 * public URL. Caller writes the URL to `item.image_url` via `updateItem`
 * or keeps it on a `Draft` for later batch save.
 *
 * The path convention (`warehouseId/filename`) lets us filter or clean up
 * by warehouse later without scanning the whole bucket.
 */
export async function uploadProductImage(
  warehouseId: string,
  localUri: string,
): Promise<string> {
  // Manipulate first — same resize/compress for both the cloud and the
  // deferred-local paths, so a lapsed user gets the same-sized image
  // back on the eventual real upload.
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: RESIZE_WIDTH } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );

  if (!isCloudEnabledNow()) {
    // Lapsed mode: cache the manipulated file under a synthetic URI and
    // hand the URI back to the caller as if it were a real URL. The UI
    // renders it via getCachedUri(); on the next sync after the user
    // resubscribes, flushDeferredImageUploads() will push it to Storage
    // and update the row's image_url to the real public URL.
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
    const deferredUri = `${DEFERRED_URI_PREFIX}${warehouseId}/${filename}`;
    await cacheImageFromLocal(deferredUri, manipulated.uri);
    return deferredUri;
  }

  // React Native's `fetch(uri).blob()` silently produces an invalid upload
  // body for Supabase Storage (empty/white file). Read raw bytes via the
  // new `File` API — `arrayBuffer()` returns a real, serializable buffer.
  const arrayBuffer = await new File(manipulated.uri).arrayBuffer();

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const path = `${warehouseId}/${filename}`;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, arrayBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error('Upload succeeded but public URL is missing.');
  }

  // Cache the resized image locally so it's available offline immediately.
  cacheImageFromLocal(data.publicUrl, manipulated.uri).catch(() => {});

  return data.publicUrl;
}

/**
 * Find items whose image_url is a deferred-local URI (captured while
 * the user's subscription was lapsed) and upload each one to Supabase
 * Storage. Updates items.image_url in-place to the real public URL,
 * which then propagates through the regular pending-changes flow on
 * the next pushSync. Idempotent — safe to call on every sync cycle.
 *
 * Called from pushSync() once isCloudEnabledNow() is true.
 */
export async function flushDeferredImageUploads(): Promise<{
  uploaded: number;
  failed: number;
}> {
  if (!isCloudEnabledNow()) return { uploaded: 0, failed: 0 };

  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    image_url: string;
    box_id: string;
    warehouse_id: string;
  }>(
    `SELECT i.id, i.image_url, i.box_id, b.warehouse_id
       FROM items i
       JOIN boxes b ON b.id = i.box_id
      WHERE i.image_url LIKE 'local:%'
        AND i._deleted_at IS NULL`,
  );

  if (rows.length === 0) return { uploaded: 0, failed: 0 };

  let uploaded = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Resolve the cached file on disk. cacheImageFromLocal writes it
      // under sha-of-url, retrievable via getCachedUri.
      const { getCachedUri } = await import('./imageCache');
      const cachedPath = getCachedUri(row.image_url);
      if (!cachedPath || cachedPath === row.image_url) {
        // Cache miss (eviction, fresh install, etc.) — the file is gone.
        // Drop the dangling local: pointer so the item just shows
        // without a photo instead of a broken image forever.
        db.runSync('UPDATE items SET image_url = NULL WHERE id = ?', [row.id]);
        failed++;
        continue;
      }

      const arrayBuffer = await new File(cachedPath).arrayBuffer();
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
      const path = `${row.warehouse_id}/${filename}`;
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: false,
        });
      if (uploadErr) {
        failed++;
        continue;
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = data?.publicUrl;
      if (!publicUrl) {
        failed++;
        continue;
      }

      // Re-key the cached file under the real public URL so the UI keeps
      // showing the same image (no flicker), and update the row.
      await cacheImageFromLocal(publicUrl, cachedPath).catch(() => {});
      db.runSync('UPDATE items SET image_url = ? WHERE id = ?', [publicUrl, row.id]);
      // Drop the stale local: cache entry; the cloud URL is now the
      // canonical key for this image.
      removeCachedImage(row.image_url).catch(() => {});
      // Enqueue an image_url UPDATE so the new cloud URL reaches the
      // server on the next pushSync. Without this, if the original
      // INSERT was already pushed (with image_url=NULL from the safety
      // filter, or before the photo was attached), the server would
      // never learn about the cloud URL. Lazy require keeps storage.ts
      // out of the sync.ts → subscription.ts → supabase.ts cycle path.
      try {
        const { enqueueChange } = require('./sync') as typeof import('./sync');
        enqueueChange('items', row.id, 'UPDATE', ['image_url']);
      } catch (e) {
        console.warn('[storage] enqueue after deferred upload failed', e);
      }

      uploaded++;
    } catch (e) {
      console.warn('[storage] deferred upload failed for item', row.id, e);
      failed++;
    }
  }

  return { uploaded, failed };
}

/**
 * Delete an uploaded image by its public URL. Best-effort — if the URL
 * doesn't match our bucket convention or the file is already gone, we
 * silently no-op. Used when the user replaces or clears a photo.
 */
export async function deleteProductImage(publicUrl: string): Promise<void> {
  // Silent no-op when cloud disabled. Orphaned images get cleaned up by
  // the 30-day TTL job once the user's subscription_expires_at lapses.
  if (!isCloudEnabledNow()) {
    await removeCachedImage(publicUrl).catch(() => {});
    return;
  }
  // Public URLs look like: https://<project>.supabase.co/storage/v1/object/public/product-images/<warehouseId>/<file>.jpg
  const marker = `/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = publicUrl.slice(idx + marker.length);
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);

  // Also remove from local image cache
  removeCachedImage(publicUrl).catch(() => {});
}
