// ============================================================================
// Kalta — sweep-storage Edge Function
//
// Garbage-collects orphaned objects in the `product-images` Storage bucket.
// An object is "orphaned" when no row in public.items references its public
// URL — typically because:
//   1. cleanup_lapsed_cloud_data() (the daily pg_cron) deleted a warehouse
//      and its items, cascading at the DB level but leaving Storage objects
//      behind (Postgres can't reach into Storage from a function).
//   2. deleteProductImage() failed mid-flight on the client (network blip
//      while the item was already removed from the items table).
//
// Invoke via HTTP POST with the Authorization header set to the service
// role JWT. Returns { deleted, scanned, durationMs }.
//
// Recommended schedule: weekly via pg_cron + pg_net (see schema.sql),
// or trigger manually from Supabase Dashboard during dev / when needed.
// ============================================================================
//
// @ts-nocheck — this file runs in Deno (Supabase Edge Runtime), not the
// React Native bundle. Local TypeScript can't resolve the Deno-flavored
// imports and would flag them; the function still type-checks fine at
// deploy time inside Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'product-images';
// Page through Storage objects in chunks. Supabase Storage list API
// returns at most 1000 per call; 1000 is a reasonable balance between
// throughput and memory.
const PAGE_SIZE = 1000;

interface StorageObject {
  name: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', {
      status: 500,
    });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1. Build the set of "expected" object paths — every items.image_url
  //    pointing at our bucket. We extract just the part after
  //    `/${BUCKET}/` so it lines up with the paths returned by the
  //    storage list API.
  const expected = new Set<string>();
  const marker = `/${BUCKET}/`;
  let lastId = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select('id, image_url')
      .gt('id', lastId)
      .not('image_url', 'is', null)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);
    if (error) {
      return new Response(`items query failed: ${error.message}`, {
        status: 500,
      });
    }
    if (!data || data.length === 0) break;
    for (const row of data as Array<{ id: string; image_url: string }>) {
      const idx = row.image_url.indexOf(marker);
      if (idx >= 0) expected.add(row.image_url.slice(idx + marker.length));
    }
    lastId = data[data.length - 1].id;
    if (data.length < PAGE_SIZE) break;
  }

  // 2. List Storage objects bucket-wide. Top-level entries are
  //    "warehouseId" folders; recurse one level to get the actual files.
  let scanned = 0;
  let deleted = 0;
  const toDelete: string[] = [];

  // List top-level "directories" — actually warehouse-id prefixes.
  // Supabase's list() returns folders as objects without `name` set to
  // a real file; need to recurse into each.
  const { data: top, error: topErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: PAGE_SIZE, sortBy: { column: 'name', order: 'asc' } });
  if (topErr) {
    return new Response(`top list failed: ${topErr.message}`, { status: 500 });
  }

  for (const entry of (top ?? []) as StorageObject[]) {
    const prefix = entry.name; // typically a warehouse UUID
    let offset = 0;
    for (;;) {
      const { data: page, error: pageErr } = await supabase.storage
        .from(BUCKET)
        .list(prefix, {
          limit: PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        });
      if (pageErr) {
        // Don't abort the whole sweep — log and continue with the next
        // prefix. Real Storage errors are rare; transient ones recover
        // on the next weekly run.
        console.warn(`list(${prefix}) failed:`, pageErr.message);
        break;
      }
      if (!page || page.length === 0) break;
      for (const obj of page as StorageObject[]) {
        scanned++;
        const fullPath = `${prefix}/${obj.name}`;
        if (!expected.has(fullPath)) toDelete.push(fullPath);
      }
      if (page.length < PAGE_SIZE) break;
      offset += page.length;
    }
  }

  // 3. Batch-delete orphans. Storage `.remove()` accepts up to ~1000
  //    paths per call.
  for (let i = 0; i < toDelete.length; i += PAGE_SIZE) {
    const batch = toDelete.slice(i, i + PAGE_SIZE);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch);
    if (rmErr) {
      console.warn('storage.remove batch failed:', rmErr.message);
      continue;
    }
    deleted += batch.length;
  }

  const body = JSON.stringify({
    scanned,
    deleted,
    durationMs: Date.now() - startedAt,
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
