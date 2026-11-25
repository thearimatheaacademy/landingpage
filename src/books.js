// Book shop: "Running on Bended Knees" paperback, £15 a copy including UK delivery, UK addresses only.
// Stock is limited: copies are reserved in the database while the buyer is on the payment page
// (public.reserve_book_order), so the shop can never take payment for more copies than it has.
import { stripeRequest } from './stripe.js';
import { deliver, loadSettings, escapeHtml, unwrap } from './email.js';

export const BOOK_ID = 'running-on-bended-knees';
const MAX_PER_ORDER = 5;
// Stripe's shortest Checkout Session is 30 minutes; the hold lasts a little longer so a session can
// never be paid after its copies were released.
const SESSION_MINUTES = 31;
const HOLD_MINUTES = 35;
const FOOTER = 'The Arimathea Academy · thearimatheaacademy.com';

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v || '');
const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isName = (v) => /^[\p{L}\p{M}][\p{L}\p{M} '’-]{0,59}$/u.test(v);
// Address lines: letters, digits and normal address punctuation; no links.
const isAddressLine = (v) => /^[\p{L}\p{M}\d][\p{L}\p{M}\d ,.'’/&()#-]{0,119}$/u.test(v) && !/https?:|www\.|\.(com|net|org|co|io|uk)\b/i.test(v);
// UK postcode (Royal Mail format), returned as "AB1 2CD".
export function ukPostcode(v) {
  const m = String(v || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : null;
}
const countsAsPayment = (env, obj) => obj?.livemode !== false || env.PREVIEW === 'true';
export const gbp = (pence) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const safe = (s) => escapeHtml(s ?? '').replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

// ── GET /api/book ── price and copies left (for the shop page).
export async function bookInfo(db) {
  const stock = await db.from('book_stock').select('title, unit_price').eq('id', BOOK_ID).single().then(unwrap);
  const { data: available, error } = await db.rpc('book_available', { p_product: BOOK_ID });
  if (error) throw error;
  return json({ title: stock.title, price: stock.unit_price, available, max_per_order: Math.min(MAX_PER_ORDER, available) });
}

// ── POST /api/book/order ── step 1 of the shop: reserve copies, then an Embedded Checkout for them.
export async function orderBook(request, env, db) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ error: 'Invalid submission' }, 400); // honeypot

  const o = {
    first_name: clean(body.first_name, 60),
    last_name: clean(body.last_name, 60),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40) || null,
    line1: clean(body.address_line1, 120),
    line2: clean(body.address_line2, 120) || null,
    city: clean(body.city, 80),
    postcode: ukPostcode(body.postcode),
    quantity: Number(body.quantity),
  };
  if (!isName(o.first_name) || !isName(o.last_name)) return json({ error: 'Please enter your first and last name (letters, spaces, hyphens and apostrophes only).' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (o.phone && o.phone.replace(/\D/g, '').length < 7) return json({ error: 'Please check your phone number, or leave it empty.' }, 400);
  if (!isAddressLine(o.line1) || (o.line2 && !isAddressLine(o.line2))) return json({ error: 'Please enter your street address.' }, 400);
  if (!isName(o.city)) return json({ error: 'Please enter your town or city.' }, 400);
  if (!o.postcode) return json({ error: 'Please enter a valid UK postcode. We can only post to UK addresses.' }, 400);
  if (!Number.isInteger(o.quantity) || o.quantity < 1 || o.quantity > MAX_PER_ORDER) return json({ error: `Please choose between 1 and ${MAX_PER_ORDER} copies.` }, 400);
  if (body.accept_terms !== true) return json({ error: 'Please accept the terms to continue.' }, 400);

  // Editing details from the payment step: release this browser's earlier hold and payment page.
  let replace = null;
  if (isUuid(body.order_id) && isUuid(body.token)) {
    const { data: old } = await db.from('book_orders').select('id, pay_token, stripe_session_id, status').eq('id', body.order_id).eq('pay_token', body.token).maybeSingle();
    if (old?.status === 'pending') {
      replace = old;
      if (old.stripe_session_id) await stripeRequest(env, 'POST', `/v1/checkout/sessions/${old.stripe_session_id}/expire`).catch(() => {});
    }
  }

  const { data, error } = await db.rpc('reserve_book_order', {
    p_product: BOOK_ID, p_quantity: o.quantity, p_hold_minutes: HOLD_MINUTES,
    p_first_name: o.first_name, p_last_name: o.last_name, p_email: o.email, p_phone: o.phone,
    p_line1: o.line1, p_line2: o.line2, p_city: o.city, p_postcode: o.postcode, p_marketing: body.marketing_consent === true,
    p_replace_order: replace?.id || null, p_replace_token: replace?.pay_token || null,
  });
  if (error) {
    const left = /sold_out:(\d+)/.exec(error.message || '');
    if (left) {
      const n = Number(left[1]);
      return json({ error: n ? `Sorry, only ${n} ${n === 1 ? 'copy is' : 'copies are'} left. Please choose ${n === 1 ? '1 copy' : `up to ${n} copies`}.` : 'Sorry, the book is sold out.', available: n, sold_out: n === 0 }, 409);
    }
    throw error;
  }
  const order = Array.isArray(data) ? data[0] : data;

  const session = await stripeRequest(env, 'POST', '/v1/checkout/sessions', {
    ui_mode: 'embedded',
    mode: 'payment',
    customer_email: order.email,
    client_reference_id: order.id,
    'metadata[kind]': 'book',
    'metadata[order_id]': order.id,
    'payment_intent_data[metadata][order_id]': order.id,
    'payment_intent_data[description]': `Running on Bended Knees × ${order.quantity} (${order.reference})`,
    return_url: `${env.SITE_URL}/api/book/return?session_id={CHECKOUT_SESSION_ID}`,
    expires_at: String(Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60),
    'line_items[0][quantity]': String(order.quantity),
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(order.unit_price),
    'line_items[0][price_data][product_data][name]': 'Running on Bended Knees (paperback)',
    'line_items[0][price_data][product_data][description]': 'By Collins Imadojemu. Price includes delivery to a UK address.',
  });
  await db.from('book_orders').update({ stripe_session_id: session.id }).eq('id', order.id);
  return json({ client_secret: session.client_secret, order: publicOrder(order) });
}

export function publicOrder(o) {
  return {
    id: o.id, token: o.pay_token, reference: o.reference, quantity: o.quantity, unit_price: o.unit_price, total: o.total_amount,
    first_name: o.first_name, last_name: o.last_name, email: o.email,
    address: [o.address_line1, o.address_line2, o.city, o.postcode].filter(Boolean),
  };
}

// ── Payments ────────────────────────────────────────────────
// A paid book Checkout Session (from the webhook or the return page; whichever comes first wins).
export async function recordBookSession(env, db, session, ctx) {
  if (session.metadata?.kind !== 'book' || session.payment_status !== 'paid' || !countsAsPayment(env, session)) return null;
  const id = session.metadata.order_id || session.client_reference_id;
  if (!isUuid(id)) return null;
  const { data: changed, error } = await db.from('book_orders')
    .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_session_id: session.id, stripe_payment_intent: session.payment_intent })
    .eq('id', id).in('status', ['pending', 'expired', 'cancelled']).select().maybeSingle();
  if (error) throw error;
  if (changed) ctx.waitUntil(sendBookEmail(env, db, changed, 'order_confirmation').catch((e) => console.error('book email', e)));
  return changed || (await db.from('book_orders').select('*').eq('id', id).maybeSingle().then(unwrap));
}

export async function refundBook(db, paymentIntent) {
  if (!paymentIntent) return;
  await db.from('book_orders').update({ status: 'refunded' }).eq('stripe_payment_intent', paymentIntent).in('status', ['paid', 'posted']);
}

// ── GET /api/book/return ── Embedded Checkout comes back here.
export async function bookReturn(url, env, db, ctx) {
  const sessionId = url.searchParams.get('session_id') || '';
  if (!/^cs_(test|live)_\w+$/.test(sessionId)) return Response.redirect(`${env.SITE_URL}/books/`, 302);
  const session = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
  if (session.metadata?.kind !== 'book') return Response.redirect(`${env.SITE_URL}/books/`, 302);
  if (session.payment_status !== 'paid') return Response.redirect(`${env.SITE_URL}/books/thank-you/?processing=1`, 302);
  const order = await recordBookSession(env, db, session, ctx);
  return Response.redirect(`${env.SITE_URL}/books/thank-you/?ref=${encodeURIComponent(order?.reference || '')}`, 302);
}

// ── Emails ──────────────────────────────────────────────────
export function bookEmail(o, template) {
  const address = [o.first_name + ' ' + o.last_name, o.address_line1, o.address_line2, o.city, o.postcode].filter(Boolean).map(safe).join('<br>');
  const items = `<p><strong>Order:</strong> ${safe(o.reference)}<br><strong>Running on Bended Knees</strong> (paperback) × ${o.quantity}<br><strong>Total paid:</strong> ${gbp(o.total_amount)} (UK delivery included)</p>`;
  const deliverTo = `<p><strong>Delivering to:</strong><br>${address}</p>`;
  if (template === 'order_confirmation') {
    return {
      subject: `Thank you for your order (${o.reference})`,
      html: `<p>Dear ${safe(o.first_name)},</p><p>Thank you for ordering <strong>Running on Bended Knees</strong> by Collins Imadojemu.</p>${items}${deliverTo}<p>We will email you again when your book has been posted. If anything in the address is wrong, just reply to this email.</p><p>The Arimathea Academy</p>`,
    };
  }
  if (template === 'posted') {
    return {
      subject: `Your book is on its way (${o.reference})`,
      html: `<p>Dear ${safe(o.first_name)},</p><p>Good news: your copy of <strong>Running on Bended Knees</strong> has been posted.</p>${items}${deliverTo}<p>We hope it blesses you. If it hasn't arrived within a week, just reply to this email.</p><p>The Arimathea Academy</p>`,
    };
  }
  throw new Error(`Unknown book email ${template}`);
}

export async function sendBookEmail(env, db, order, template) {
  const { subject, html } = bookEmail(order, template);
  const [row] = await deliver(env, db, await loadSettings(db), [{
    to: { email: order.email, first_name: order.first_name, last_name: order.last_name },
    kind: 'book', book_order_id: order.id, template, subject, html, footer: FOOTER,
  }]);
  return row;
}

// ── Admin ───────────────────────────────────────────────────
export async function adminBook(api, request, env, db) {
  const body = await request.json().catch(() => ({}));
  if (!isUuid(body.order_id)) return json({ error: 'Missing order' }, 400);
  if (api === '/admin/book/posted') {
    const { data: order, error } = await db.from('book_orders').update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', body.order_id).eq('status', 'paid').select().maybeSingle();
    if (error) throw error;
    if (!order) return json({ error: 'Only paid orders that have not been posted can be marked as posted.' }, 409);
    const row = body.send_email === false ? null : await sendBookEmail(env, db, order, 'posted');
    return json({ ok: true, emailed: row?.status === 'sent' });
  }
  return json({ error: 'Not found' }, 404);
}
