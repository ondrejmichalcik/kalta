// ============================================================================
// Kalta — verify-receipt Edge Function
//
// Server-side validation of a StoreKit transactionId against Apple's
// App Store Server API. Replaces the previous "trust client" path where
// the React Native client wrote `subscription_expires_at` directly to
// public.users — a jailbroken device could have forged any value there.
//
// Flow:
//   1. Client (subscription.ts) gets the active subscription's
//      transactionId from StoreKit and POSTs it here with its session JWT.
//   2. This function authenticates the caller (Supabase user JWT), signs
//      its own short-lived JWT for the App Store Server API using the
//      Apple-issued .p8 private key, and queries Apple for the canonical
//      transaction info.
//   3. Apple returns a signed JWS containing the authoritative
//      `expiresDate`, `bundleId`, `productId`, etc. We trust Apple's
//      response (no further crypto needed) and update users.
//   4. Production endpoint is tried first; on 404 we fall back to the
//      sandbox endpoint so the same code works for TestFlight builds.
//
// Required secrets (set via `supabase secrets set ...`):
//   APP_STORE_API_KEY_P8       — full contents of the .p8 file, including
//                                BEGIN/END PRIVATE KEY lines
//   APP_STORE_API_KEY_ID       — the 10-char Key ID Apple shows next to
//                                the key in ASC
//   APP_STORE_API_ISSUER_ID    — the UUID Issuer ID from ASC →
//                                Integrations → App Store Server API
//   APP_STORE_BUNDLE_ID        — defaults to com.ondrejmichalcik.kalta if unset
// ============================================================================
//
// @ts-nocheck — Deno runtime; local TS would flag the imports.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5';

const DEFAULT_BUNDLE_ID = 'com.ondrejmichalcik.kalta';
const EXPECTED_PRODUCT_ID = 'com.ondrejmichalcik.kalta.cloud_yearly';

const APPLE_PROD = 'https://api.storekit.itunes.apple.com';
const APPLE_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';

interface RequestBody {
  transactionId: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // 1. Auth check — only authenticated Supabase users may invoke.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Server misconfigured (no Supabase env)' }, 500);
  }

  // 1a. Use the caller's JWT against an anon client to recover their user id.
  //     Service-role updates use the elevated client below.
  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anonClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: 'Invalid session' }, 401);
  }
  const userId = userData.user.id;

  // 2. Parse body.
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const transactionId = (body?.transactionId ?? '').trim();
  if (!transactionId) {
    return json({ error: 'Missing transactionId' }, 400);
  }

  // 3. Build the Apple App Store Server API JWT.
  const p8 = Deno.env.get('APP_STORE_API_KEY_P8');
  const keyId = Deno.env.get('APP_STORE_API_KEY_ID');
  const issuerId = Deno.env.get('APP_STORE_API_ISSUER_ID');
  const bundleId = Deno.env.get('APP_STORE_BUNDLE_ID') ?? DEFAULT_BUNDLE_ID;
  if (!p8 || !keyId || !issuerId) {
    return json(
      { error: 'Server misconfigured (missing Apple credentials)' },
      500,
    );
  }

  let appleJwt: string;
  try {
    const privateKey = await importPKCS8(p8, 'ES256');
    appleJwt = await new SignJWT({ bid: bundleId })
      .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
      .setIssuer(issuerId)
      .setAudience('appstoreconnect-v1')
      .setIssuedAt()
      .setExpirationTime('20m')
      .sign(privateKey);
  } catch (e) {
    console.error('[verify-receipt] failed to sign Apple JWT', e);
    return json({ error: 'Apple JWT signing failed' }, 500);
  }

  // 4. Query Apple. Try production first; fall back to sandbox on 404 so
  //    TestFlight builds (whose transactions live in the sandbox env)
  //    get validated by the same function.
  let appleRes = await fetch(
    `${APPLE_PROD}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${appleJwt}` } },
  );
  let env: 'production' | 'sandbox' = 'production';
  if (appleRes.status === 404) {
    env = 'sandbox';
    appleRes = await fetch(
      `${APPLE_SANDBOX}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${appleJwt}` } },
    );
  }
  if (!appleRes.ok) {
    const text = await appleRes.text();
    console.warn('[verify-receipt] Apple non-2xx', appleRes.status, text);
    return json(
      { error: 'Apple verification failed', status: appleRes.status },
      502,
    );
  }

  const apple = (await appleRes.json()) as { signedTransactionInfo?: string };
  const jws = apple.signedTransactionInfo;
  if (!jws) {
    return json({ error: 'Apple response missing signedTransactionInfo' }, 502);
  }

  // 5. Decode the JWS payload. Apple already signed it; we just need to
  //    read it. The middle base64url segment of a JWS is the payload.
  const segments = jws.split('.');
  if (segments.length !== 3) {
    return json({ error: 'Malformed JWS from Apple' }, 502);
  }
  let payload: any;
  try {
    payload = JSON.parse(b64urlDecode(segments[1]));
  } catch {
    return json({ error: 'Could not decode JWS payload' }, 502);
  }

  // 6. Sanity-check the payload matches the caller's app + product.
  if (payload.bundleId !== bundleId) {
    return json({ error: 'Bundle ID mismatch' }, 400);
  }
  if (payload.productId !== EXPECTED_PRODUCT_ID) {
    return json(
      { error: 'Product ID mismatch', got: payload.productId },
      400,
    );
  }
  const expiresMs = Number(payload.expiresDate);
  if (!Number.isFinite(expiresMs)) {
    return json({ error: 'Missing/invalid expiresDate on transaction' }, 502);
  }
  const expiresIso = new Date(expiresMs).toISOString();

  // 7. Write authoritative value with service role (bypasses RLS).
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
    env,
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

function b64urlDecode(s: string): string {
  // Base64URL → Base64 → string
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return atob(padded);
}
