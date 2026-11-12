// Minimal Stripe REST calls (no SDK needed on Workers).

// Pinned so request/response shapes (ui_mode=embedded, invoice fields) don't change under us when the
// account's default API version is upgraded in the Stripe dashboard.
export const STRIPE_API_VERSION = '2024-06-20';

const BOOTCAMP_NAME = 'Kingdom School of Business & Ministry Bootcamp';

// Bootcamp: the full £150, or one £50 instalment. Embedded Checkout, shown inside step 2 of /register/.
// `next` comes from plan.js nextPayment(): { amount, instalment } (instalment null = paying in full).
export async function createCheckoutSession(env, registrant, next = { amount: 15000, instalment: null }) {
  const p = {
    ui_mode: 'embedded',
    mode: 'payment',
    customer_email: registrant.email,
    client_reference_id: registrant.id,
    'metadata[kind]': 'bootcamp',
    'metadata[registrant_id]': registrant.id,
    'metadata[payment_kind]': next.instalment ? 'instalment' : 'full',
    ...(next.instalment ? { 'metadata[instalment]': String(next.instalment) } : {}),
    'payment_intent_data[metadata][registrant_id]': registrant.id,
    'payment_intent_data[description]': BOOTCAMP_NAME,
    // After paying, students go straight into the portal (see claimAfterPayment).
    return_url: `${env.SITE_URL}/api/lms/claim?session_id={CHECKOUT_SESSION_ID}`,
    'line_items[0][quantity]': '1',
    // Sessions expire after 24h; the reminder emails create a fresh one via /api/pay.
    expires_at: String(Math.floor(Date.now() / 1000) + 23 * 3600),
  };
  if (next.instalment) {
    Object.assign(p, {
      'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': String(next.amount),
      'line_items[0][price_data][product_data][name]': `${BOOTCAMP_NAME}: instalment ${next.instalment} of 3`,
      'line_items[0][price_data][product_data][description]': '£150 paid in 3 monthly instalments of £50 · Every Friday from 11 December 2026 · Zoom',
    });
  } else if (env.STRIPE_PRICE_ID) {
    p['line_items[0][price]'] = env.STRIPE_PRICE_ID;
  } else {
    Object.assign(p, {
      'line_items[0][price_data][currency]': 'gbp',
      'line_items[0][price_data][unit_amount]': '15000',
      'line_items[0][price_data][product_data][name]': BOOTCAMP_NAME,
      'line_items[0][price_data][product_data][description]': '15-week online programme · Every Friday from 11 December 2026 · Zoom',
    });
  }
  // Same registrant retrying within a minute reuses the same session.
  return stripeRequest(env, 'POST', '/v1/checkout/sessions', p, `${registrant.id}-${next.instalment || 'full'}-${Math.floor(Date.now() / 60000)}`);
}

// Retreat: any set of line items ({ name, description, amount, quantity }) for one booking.
export async function createRetreatSession(env, booking, { lines, paymentKind, returnUrl }) {
  const p = {
    ui_mode: 'embedded',
    mode: 'payment',
    client_reference_id: booking.id,
    'metadata[kind]': 'retreat',
    'metadata[booking_id]': booking.id,
    'metadata[payment_kind]': paymentKind,
    'payment_intent_data[metadata][booking_id]': booking.id,
    'payment_intent_data[description]': `End of Year Retreat ${booking.reference} (${paymentKind})`,
    return_url: returnUrl,
    expires_at: String(Math.floor(Date.now() / 1000) + 23 * 3600),
  };
  // Reuse the Stripe customer once we have one, so invoices and receipts sit together in Stripe.
  if (booking.stripe_customer_id) p.customer = booking.stripe_customer_id;
  else Object.assign(p, { customer_email: booking.email, customer_creation: 'always' });
  lines.forEach((l, i) => {
    Object.assign(p, {
      [`line_items[${i}][quantity]`]: String(l.quantity),
      [`line_items[${i}][price_data][currency]`]: 'gbp',
      [`line_items[${i}][price_data][unit_amount]`]: String(l.amount),
      [`line_items[${i}][price_data][product_data][name]`]: l.name,
      ...(l.description ? { [`line_items[${i}][price_data][product_data][description]`]: l.description } : {}),
    });
  });
  return stripeRequest(env, 'POST', '/v1/checkout/sessions', p);
}

// Creates, finalises and emails a Stripe invoice for `amount` pence. Stripe hosts the payment page.
export async function sendRetreatInvoice(env, booking, { amount, description, daysUntilDue }) {
  let customer = booking.stripe_customer_id;
  if (!customer) {
    customer = (await stripeRequest(env, 'POST', '/v1/customers', {
      email: booking.email,
      name: `${booking.first_name} ${booking.last_name}`,
      ...(booking.phone ? { phone: booking.phone } : {}),
      'metadata[booking_id]': booking.id,
    })).id;
  }
  const meta = { 'metadata[kind]': 'retreat', 'metadata[booking_id]': booking.id, 'metadata[reference]': booking.reference };
  const invoice = await stripeRequest(env, 'POST', '/v1/invoices', {
    customer,
    currency: 'gbp',
    collection_method: 'send_invoice',
    days_until_due: String(daysUntilDue),
    pending_invoice_items_behavior: 'exclude',
    description: `End of Year Retreat, 28 to 31 December 2026. Booking ${booking.reference}.`,
    ...meta,
  });
  await stripeRequest(env, 'POST', '/v1/invoiceitems', { customer, invoice: invoice.id, currency: 'gbp', amount: String(amount), description, ...meta });
  await stripeRequest(env, 'POST', `/v1/invoices/${invoice.id}/finalize`);
  const sent = await stripeRequest(env, 'POST', `/v1/invoices/${invoice.id}/send`);
  return { customer, invoice: sent };
}

export async function stripeRequest(env, method, path, params = {}, idempotencyKey) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://api.stripe.com${path}${method === 'GET' && qs.size ? `?${qs}` : ''}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': STRIPE_API_VERSION,
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
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
