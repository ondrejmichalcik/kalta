// ============================================================================
// Kalta — verify-receipt Edge Function (JWS local verification)
//
// Server-side validation of a StoreKit-signed JWS transaction. Replaces
// the earlier App Store Server API path (Apple JWT auth kept returning
// 401s during initial key propagation), with the same security
// guarantee:
//   • Apple-signed JWS — the only way to produce a valid one is to
//     hold Apple's App Store signing private key, which obviously
//     nobody but Apple has.
//   • Cert chain rooted to Apple Root CA G3 — pinned by SHA-256
//     fingerprint, so an attacker can't substitute their own chain.
//   • Bundle ID + product ID claims verified against expected values
//     so a JWS from a different app can't be replayed.
//
// Client (src/lib/subscription.ts) posts:
//   { jws: <PurchaseIOS.purchaseToken> }
//
// On success we write Apple's authoritative `expiresDate` to
// public.users via the service-role client (bypasses the column-level
// RLS revoke that blocks authenticated users from touching the
// subscription columns directly).
// ============================================================================
//
// @ts-nocheck — Deno runtime; local TS would flag the imports.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { compactVerify, decodeProtectedHeader } from 'https://esm.sh/jose@5';
import { X509Certificate } from 'https://esm.sh/@peculiar/x509@1.12.3';

const DEFAULT_BUNDLE_ID = 'com.ondrejmichalcik.kalta';
const EXPECTED_PRODUCT_ID = 'com.ondrejmichalcik.kalta.cloud_yearly';

// SHA-256 fingerprint of Apple Root CA G3 (the root signing the App
// Store Server certificate chain). Published by Apple at
// https://www.apple.com/certificateauthority/. Pinning this hash means
// even a future change to Apple's intermediate cert layout doesn't
// break us — only a totally new root would, and that's an Apple-level
// announcement we'd see in time.
const APPLE_ROOT_G3_SHA256 =
  '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';

interface RequestBody {
  jws: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 1. Auth — only authenticated Supabase users may invoke.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server misconfigured (no Supabase env)' }, 500);
  }
  const anonClient = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'Invalid session' }, 401);
  }
  const userId = userData.user.id;

  // 2. Body parse.
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const jws = (body?.jws ?? '').trim();
  if (!jws || jws.split('.').length !== 3) {
    return json({ error: 'Missing or malformed jws' }, 400);
  }

  // 3. Decode the JWS header to pull out the x5c cert chain.
  let header: any;
  try {
    header = decodeProtectedHeader(jws);
  } catch (e) {
    return json({ error: 'Could not decode JWS header', detail: String(e) }, 400);
  }
  const x5c = header?.x5c as string[] | undefined;
  if (!Array.isArray(x5c) || x5c.length < 1) {
    return json({ error: 'JWS missing x5c certificate chain' }, 400);
  }

  // 4. Pin the chain root to Apple Root CA G3.
  let rootCert: X509Certificate;
  try {
    rootCert = new X509Certificate(base64ToBytes(x5c[x5c.length - 1]));
  } catch (e) {
    return json({ error: 'Could not parse root cert', detail: String(e) }, 400);
  }
  const rootHash = await sha256Hex(new Uint8Array(rootCert.rawData));
  if (rootHash !== APPLE_ROOT_G3_SHA256) {
    console.warn('[verify-receipt] root cert hash mismatch', rootHash);
    return json({ error: 'JWS root cert is not Apple Root CA G3' }, 400);
  }

  // 5. Parse the whole chain and verify each cert is signed by the
  //    next one up. The peculiar/x509 verify() does the cryptographic
  //    check against the issuer's public key.
  let certs: X509Certificate[];
  try {
    certs = x5c.map((b64) => new X509Certificate(base64ToBytes(b64)));
  } catch (e) {
    return json({ error: 'Cert chain parse failed', detail: String(e) }, 400);
  }
  for (let i = 0; i < certs.length - 1; i++) {
    const ok = await certs[i].verify({ publicKey: certs[i + 1].publicKey });
    if (!ok) {
      console.warn('[verify-receipt] chain link failed at', i);
      return json({ error: `Chain validation failed at cert ${i}` }, 400);
    }
  }

  // 6. Verify the JWS itself with the leaf cert's public key.
  let payload: any;
  try {
    const leafPubKey = await certs[0].publicKey.export();
    const result = await compactVerify(jws, leafPubKey);
    payload = JSON.parse(new TextDecoder().decode(result.payload));
  } catch (e) {
    console.warn('[verify-receipt] JWS signature verify failed', e);
    return json({ error: 'JWS signature verification failed' }, 400);
  }

  // 7. Validate claims against what we expect for this app.
  const bundleId = Deno.env.get('APP_STORE_BUNDLE_ID') ?? DEFAULT_BUNDLE_ID;
  if (payload.bundleId !== bundleId) {
    return json({ error: 'Bundle ID mismatch', got: payload.bundleId }, 400);
  }
  if (payload.productId !== EXPECTED_PRODUCT_ID) {
    return json({ error: 'Product ID mismatch', got: payload.productId }, 400);
  }
  const expiresMs = Number(payload.expiresDate);
  if (!Number.isFinite(expiresMs)) {
    return json({ error: 'Missing/invalid expiresDate on transaction' }, 400);
  }
  const expiresIso = new Date(expiresMs).toISOString();

  // 8. Write authoritative state with service role.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: updErr } = await adminClient
    .from('users')
    .update({
      subscription_expires_at: expiresIso,
      subscription_product_id: payload.productId,
    })
    .eq('id', userId);
  if (updErr) {
    console.error('[verify-receipt] users update failed', updErr);
    return json({ error: 'Database update failed' }, 500);
  }

  return json({
    success: true,
    env: payload.environment ?? 'unknown',
    expiresAt: expiresIso,
    productId: payload.productId,
  });
});

// Helpers --------------------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  // Accept both regular base64 and base64url.
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
