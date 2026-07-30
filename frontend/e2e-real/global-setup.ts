/**
 * global-setup.ts — Real-backend globalSetup for the e2e-real suite.
 *
 * Runs once before all tests.  It:
 *   1. Verifies GET /health returns 200 (stack is up).
 *   2. Mints a seller JWT via POST /api/v1/auth/login { id: 12345 }
 *      and stores it in process.env.VLIQ_SELLER_JWT.
 *   3. Attempts to mint an admin JWT via POST /api/v1/auth/login { id: 809296638 }.
 *      The backend currently returns role='seller' for ALL /auth/login calls
 *      (admin auth is not yet exposed via this dev endpoint — the admin table
 *      has telegram_id=809296638 with role=super_admin but the JWT comes out as
 *      'seller').  We store whatever token we get in VLIQ_ADMIN_JWT and set
 *      VLIQ_ADMIN_AVAILABLE=false so admin specs can skip themselves.
 */

// Node 18+ has built-in global fetch — no import needed.

const BASE = 'http://localhost:8080'

async function globalSetup() {
  // ── 1. Health check ───────────────────────────────────────────────────────
  let healthRes: Awaited<ReturnType<typeof fetch>>
  try {
    healthRes = await fetch(`${BASE}/health`, { method: 'GET' })
  } catch (err) {
    throw new Error(
      `[globalSetup] Cannot reach ${BASE}/health — is the docker-compose stack running?\n${String(err)}`,
      { cause: err },
    )
  }
  if (healthRes.status !== 200) {
    throw new Error(
      `[globalSetup] GET /health returned ${healthRes.status}, expected 200.`,
    )
  }
  console.log('[globalSetup] /health OK')

  // ── 2. Seller JWT ─────────────────────────────────────────────────────────
  const sellerRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 12345 }),
  })
  if (!sellerRes.ok) {
    throw new Error(
      `[globalSetup] POST /auth/login { id: 12345 } returned ${sellerRes.status}`,
    )
  }
  const sellerBody = (await sellerRes.json()) as { access_token: string; role: string }
  process.env['VLIQ_SELLER_JWT'] = sellerBody.access_token
  console.log(`[globalSetup] Seller JWT minted (role=${sellerBody.role})`)

  // ── 3. Admin JWT ──────────────────────────────────────────────────────────
  // KNOWN LIMITATION: /api/v1/auth/login always resolves against the sellers
  // table and returns role='seller'.  telegram_id=809296638 exists in the admin
  // table (role=super_admin) but the dev-auth endpoint does NOT check the admin
  // table — it either finds a seller row or auto-creates one.  Until the backend
  // ships a dedicated /auth/admin-login (or tma-verify handles admin lookups),
  // we cannot obtain a real admin JWT here.
  //
  // IMPACT: admin specs (admin-review-flow, admin-payout-flow, admin-sellers-page)
  // are skipped via test.skip(process.env.VLIQ_ADMIN_AVAILABLE !== 'true', ...).
  let adminAvailable = false
  try {
    const adminRes = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 809296638 }),
    })
    if (adminRes.ok) {
      const adminBody = (await adminRes.json()) as { access_token: string; role: string }
      process.env['VLIQ_ADMIN_JWT'] = adminBody.access_token
      // Only mark admin available if the backend actually returned an admin role
      if (adminBody.role === 'admin' || adminBody.role === 'super_admin') {
        adminAvailable = true
        console.log(`[globalSetup] Admin JWT minted (role=${adminBody.role})`)
      } else {
        console.warn(
          `[globalSetup] SKIP admin tests — POST /auth/login { id: 809296638 } returned role='${adminBody.role}' (expected 'admin' or 'super_admin'). ` +
          'Backend /auth/login does not check the admin table; admin-role JWT unavailable. ' +
          'Admin tests will be skipped until backend ships admin-aware auth.',
        )
      }
    }
  } catch {
    console.warn('[globalSetup] Admin login request failed — admin tests will be skipped')
  }
  process.env['VLIQ_ADMIN_AVAILABLE'] = adminAvailable ? 'true' : 'false'
}

export default globalSetup
