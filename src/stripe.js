// Minimal Stripe REST calls (no SDK needed on Workers).

export async function createCheckoutSession(env, registrant) {
  const p = new URLSearchParams({
    mode: 'payment',
    customer_email: registrant.email,
    client_reference_id: registrant.id,
    'metadata[registrant_id]': registrant.id,
    'payment_intent_data[metadata][registrant_id]': registrant.id,
    'payment_intent_data[description]': 'Kingdom School of Business & Ministry Bootcamp',
    // After paying, students go straight into the portal (see claimAfterPayment).
    success_url: `${env.SITE_URL}/api/lms/claim?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_URL}/cancelled/?id=${registrant.id}&t=${registrant.pay_token}`,
    'line_items[0][quantity]': '1',
    // Sessions expire after 24h; the reminder emails create a fresh one via /api/pay.
    expires_at: String(Math.floor(Date.now() / 1000) + 23 * 3600),
  });
  if (env.STRIPE_PRICE_ID) {
    p.set('line_items[0][price]', env.STRIPE_PRICE_ID);
  } else {
    p.set('line_items[0][price_data][currency]', 'gbp');
    p.set('line_items[0][price_data][unit_amount]', '15000');
    p.set('line_items[0][price_data][product_data][name]', 'Kingdom School of Business & Ministry Bootcamp');
    p.set('line_items[0][price_data][product_data][description]', '15-week online programme · Every Friday from 11 December 2026 · Zoom');
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      // Same registrant retrying within a minute reuses the same session.
      'idempotency-key': `${registrant.id}-${Math.floor(Date.now() / 60000)}`,
    },
    body: p,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}

export async function stripeRequest(env, method, path, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com${path}${method === 'GET' && qs.size ? `?${qs}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : qs,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}

// Verifies the Stripe-Signature header (HMAC-SHA256 over "timestamp.payload").
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')).filter((p) => p[0] === 't'));
  const signatures = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!t || !signatures.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return signatures.some((s) => timingSafeEqual(s, expected));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
