// ============================================================================
// Kalta – Storage helpers
// Upload / delete product images on the Supabase `product-images` bucket.
// ============================================================================
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import { cacheImageFromLocal, removeCachedImage } from './imageCache';

const BUCKET = 'product-images';

// Resize target: keeps UI thumbnails crisp on retina screens while holding
// file sizes around 80–150 KB per image. Height scales proportionally.
const RESIZE_WIDTH = 800;
const JPEG_QUALITY = 0.7; // 0..1, ImageManipulator scale

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
  // Manipulate: resize + re-encode as JPEG. Output uri is a temp file.
  const manipulated = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: RESIZE_WIDTH } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
  );

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
 * Delete an uploaded image by its public URL. Best-effort — if the URL
 * doesn't match our bucket convention or the file is already gone, we
 * silently no-op. Used when the user replaces or clears a photo.
 */
export async function deleteProductImage(publicUrl: string): Promise<void> {
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
