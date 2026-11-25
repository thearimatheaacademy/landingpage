import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, createClient } from './helpers/fake-supabase.mjs';
import { orderBook, recordBookSession, refundBook, adminBook, bookInfo, copiesLeft, ukPostcode, bookEmail } from '../src/books.js';

const env = { SITE_URL: 'https://site.example', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b', STRIPE_SECRET_KEY: 'sk_test_x' };
const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
const settle = () => Promise.all(ctx.pending.splice(0));
let stripe, emails;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com')) { const b = JSON.parse(init.body); emails.push(...b); return Response.json({ data: b.map((_, i) => ({ id: 'e' + i })) }); }
  const path = new URL(url).pathname;
  stripe.push({ path, params: Object.fromEntries(new URLSearchParams(init.body || '')) });
  return Response.json({ id: 'cs_test_' + stripe.length, client_secret: 'secret_' + stripe.length });
};
beforeEach(() => {
  for (const t of Object.keys(DB.tables)) DB.tables[t] = [];
  DB.tables.book_stock.push({ id: 'running-on-bended-knees', title: 'Running on Bended Knees', unit_price: 1500, stock_total: 10 });
  stripe = []; emails = [];
});
const req = (b) => new Request('https://site.example/api/book/order', { method: 'POST', body: JSON.stringify(b) });
const buyer = { first_name: 'Ada', last_name: "O'Neil", email: 'Ada@Example.com', address_line1: '12 High Street', address_line2: 'Flat 3', city: 'Leeds', postcode: 'ls11aa', quantity: 2, accept_terms: true };

test('UK postcodes only, tidied to the Royal Mail format', () => {
  assert.equal(ukPostcode('ls11aa'), 'LS1 1AA');
  assert.equal(ukPostcode('SW1A 1AA'), 'SW1A 1AA');
  assert.equal(ukPostcode('EC1A1BB'), 'EC1A 1BB');
  assert.equal(ukPostcode('10115'), null);      // Berlin
  assert.equal(ukPostcode('K1A 0B1'), null);    // Canada
  assert.equal(ukPostcode(''), null);
});

test('order: £15 a copy from the server, embedded checkout, stock held', async () => {
  const db = createClient();
  const res = await orderBook(req({ ...buyer, price: 1 }), env, db);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.order.total, 3000);
  assert.deepEqual(out.order.address, ['12 High Street', 'Flat 3', 'Leeds', 'LS1 1AA']);
  const s = stripe[0].params;
  assert.equal(s.ui_mode, 'embedded');
  assert.equal(s['line_items[0][price_data][unit_amount]'], '1500');
  assert.equal(s['line_items[0][quantity]'], '2');
  assert.equal(s['metadata[kind]'], 'book');
  assert.ok(Number(s.expires_at) - Date.now() / 1000 >= 30 * 60, 'Stripe needs at least 30 minutes');
  assert.equal(await copiesLeft(db), 8);
  // The public endpoint never reveals the count.
  assert.deepEqual(await (await bookInfo(db)).json(), { title: 'Running on Bended Knees', price: 1500, sold_out: false, max_per_order: 5 });
});

test('never more than 10 copies: the 11th is refused, and an expired hold frees copies', async () => {
  const db = createClient();
  for (const q of [5, 5]) assert.equal((await orderBook(req({ ...buyer, quantity: q }), env, db)).status, 200);
  const r = await orderBook(req({ ...buyer, quantity: 1 }), env, db);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'Sorry, the book is sold out.', sold_out: true });
  assert.equal((await (await bookInfo(db)).json()).sold_out, true);
  DB.tables.book_orders[0].hold_expires_at = new Date(Date.now() - 1000).toISOString();
  const partial = await orderBook(req({ ...buyer, quantity: 5 }), env, db);
  assert.equal(partial.status, 200);
  const tooMany = await orderBook(req({ ...buyer, quantity: 2 }), env, db);
  assert.equal(tooMany.status, 409);
  assert.doesNotMatch(JSON.stringify(await tooMany.json()), /"available"|only \d/);
});

test('editing details releases your own hold and expires the old payment page', async () => {
  const db = createClient();
  const first = await (await orderBook(req({ ...buyer, quantity: 5 }), env, db)).json();
  await orderBook(req({ ...buyer, quantity: 5, order_id: first.order.id, token: first.order.token }), env, db);
  assert.equal(DB.tables.book_orders[0].status, 'cancelled');
  assert.ok(stripe.some((c) => c.path === '/v1/checkout/sessions/cs_test_1/expire'));
  assert.equal(await copiesLeft(db), 5);
});

test('bad input is refused: non-UK postcode, links in the address, too many copies', async () => {
  const db = createClient();
  assert.equal((await orderBook(req({ ...buyer, postcode: '10115' }), env, db)).status, 400);
  assert.equal((await orderBook(req({ ...buyer, address_line1: 'www.example.com' }), env, db)).status, 400);
  assert.equal((await orderBook(req({ ...buyer, quantity: 6 }), env, db)).status, 400);
  assert.equal((await orderBook(req({ ...buyer, first_name: 'Call 0800' }), env, db)).status, 400);
  assert.equal((await orderBook(req({ ...buyer, accept_terms: false }), env, db)).status, 400);
  assert.equal(DB.tables.book_orders.length, 0);
});

test('paid: recorded once, confirmation emailed; posted emails the buyer; refunds return stock', async () => {
  const db = createClient();
  const { order } = await (await orderBook(req(buyer), env, db)).json();
  const session = { id: 'cs_test_1', metadata: { kind: 'book', order_id: order.id }, payment_status: 'paid', payment_intent: 'pi_b' };
  assert.equal((await recordBookSession(env, db, { ...session, livemode: false }, ctx)), null, 'test-mode never counts on the live site');
  await recordBookSession(env, db, session, ctx); await recordBookSession(env, db, session, ctx); await settle();
  assert.equal(DB.tables.book_orders[0].status, 'paid');
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /Thank you for your order/);
  assert.match(emails[0].html, /LS1 1AA/);

  const posted = await adminBook('/admin/book/posted', new Request('https://x/', { method: 'POST', body: JSON.stringify({ order_id: order.id }) }), env, db);
  assert.equal(posted.status, 200);
  assert.equal(DB.tables.book_orders[0].status, 'posted');
  assert.match(emails.at(-1).subject, /on its way/);

  await refundBook(db, 'pi_b');
  assert.equal(DB.tables.book_orders[0].status, 'refunded');
  assert.equal(await copiesLeft(db), 10);
});

test('names and addresses cannot inject HTML or merge tags into emails', () => {
  const { html } = bookEmail({ reference: 'BK-1', first_name: '<b>{{zoom_link}}', last_name: 'X', address_line1: '<script>', city: 'Leeds', postcode: 'LS1 1AA', quantity: 1, total_amount: 1500 }, 'order_confirmation');
  assert.doesNotMatch(html, /<script>|<b>|\{\{/);
});
