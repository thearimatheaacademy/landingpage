import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, createClient } from './helpers/fake-supabase.mjs';
import { quote, book, balanceCheckout, recordSession, recordInvoice, recordRefund, pickReminder, runRetreatReminders, adminRetreat, retreatEmail, gbp } from '../src/retreat.js';

const env = { SITE_URL: 'https://site.example', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b', STRIPE_SECRET_KEY: 'sk_test_x', RETREAT_OPEN: 'true' };
const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
const settle = () => Promise.all(ctx.pending.splice(0));

// Fake Stripe + Resend. Records every call so tests can check what was sent.
let stripeCalls, emails;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com')) {
    const batch = JSON.parse(init.body);
    emails.push(...batch);
    return new Response(JSON.stringify({ data: batch.map((_, i) => ({ id: 'e' + i })) }));
  }
  const path = new URL(url).pathname;
  const params = Object.fromEntries(new URLSearchParams(init.body || ''));
  stripeCalls.push({ path, params, version: init.headers['stripe-version'] });
  if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_test_' + stripeCalls.length, client_secret: 'secret_' + stripeCalls.length });
  if (path === '/v1/customers') return Response.json({ id: 'cus_1' });
  if (path === '/v1/invoices') return Response.json({ id: 'in_1', status: 'draft' });
  if (path === '/v1/invoiceitems') return Response.json({ id: 'ii_1' });
  if (path.endsWith('/finalize')) return Response.json({ id: 'in_1', status: 'open' });
  if (path.endsWith('/send')) return Response.json({ id: 'in_1', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/i/1' });
  if (path.endsWith('/void')) return Response.json({ id: 'in_1', status: 'void' });
  return Response.json({ error: { message: 'unexpected ' + path } }, { status: 400 });
};

beforeEach(() => {
  for (const t of Object.keys(DB.tables)) DB.tables[t] = [];
  stripeCalls = [];
  emails = [];
});

const req = (body) => new Request('https://site.example/api/x', { method: 'POST', body: JSON.stringify(body) });
const booker = { first_name: 'Ada', last_name: 'Obi', email: 'Ada@Example.com', phone: '07700 900000', accept_terms: true };
const twoPeople = [{ first_name: 'Ada', last_name: 'Obi', room: 'double' }, { first_name: 'Ben', last_name: 'Obi', room: 'single', dietary: 'Vegetarian' }];

test('quote: prices come from the server, deposit is £50 per person', () => {
  assert.deepEqual(quote(twoPeople, 'full'), { counts: { double: 1, single: 1 }, total: 63000, deposit: 10000, dueNow: 63000 });
  assert.equal(quote(twoPeople, 'deposit').dueNow, 10000);
  assert.throws(() => quote([], 'full'), /at least one/);
  assert.throws(() => quote([{ room: 'penthouse' }], 'full'), /room/);
  assert.throws(() => quote(Array(11).fill({ room: 'single' }), 'full'), /up to 10/);
  assert.equal(gbp(28500), '£285');
  assert.equal(gbp(23550), '£235.50');
});

test('booking with a deposit: embedded checkout for 2 × £50, then deposit email with balance link', async () => {
  const db = createClient();
  const res = await book(req({ ...booker, payment_option: 'deposit', attendees: twoPeople, price: 1 }), env, db);
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.client_secret, 'secret_1');
  assert.equal(out.due_now, 10000);
  assert.equal(out.booking.total, 63000);

  const s = stripeCalls[0];
  assert.equal(s.params.ui_mode, 'embedded');
  assert.equal(s.version, '2024-06-20');
  assert.equal(s.params['line_items[0][price_data][unit_amount]'], '5000');
  assert.equal(s.params['line_items[0][quantity]'], '2');
  assert.equal(s.params['metadata[payment_kind]'], 'deposit');
  assert.equal(s.params.customer_creation, 'always');
  assert.match(s.params.return_url, /\/api\/retreat\/return\?session_id=\{CHECKOUT_SESSION_ID\}$/);

  const b = DB.tables.retreat_bookings[0];
  assert.equal(b.email, 'ada@example.com');
  assert.equal(DB.tables.retreat_attendees.length, 2);
  assert.equal(DB.tables.retreat_attendees[1].unit_price, 34500);

  const session = { id: 'cs_test_1', metadata: { kind: 'retreat', booking_id: b.id, payment_kind: 'deposit' }, payment_status: 'paid', amount_total: 10000, currency: 'gbp', payment_intent: 'pi_dep', customer: 'cus_9' };
  const after = await recordSession(env, db, session, ctx);
  await settle();
  assert.equal(after.status, 'deposit_paid');
  assert.equal(after.amount_paid, 10000);
  assert.equal(DB.tables.retreat_bookings[0].stripe_customer_id, 'cus_9');
  assert.equal(emails.length, 1);
  assert.match(emails[0].subject, /reserved/);
  assert.match(emails[0].html, new RegExp(`/retreat/book/\\?id=${b.id}&amp;t=${b.pay_token}`));
  assert.match(emails[0].html, /£530/);

  // The webhook and the return page both report the same session: counted and emailed once.
  await recordSession(env, db, session, ctx);
  await settle();
  assert.equal(DB.tables.retreat_payments.length, 1);
  assert.equal(emails.length, 1);
});

test('balance link pays exactly what is owed, then a paid-in-full email', async () => {
  const db = createClient();
  await book(req({ ...booker, payment_option: 'deposit', attendees: twoPeople }), env, db);
  const b = DB.tables.retreat_bookings[0];
  await recordSession(env, db, { id: 'cs_a', metadata: { kind: 'retreat', booking_id: b.id, payment_kind: 'deposit' }, payment_status: 'paid', amount_total: 10000, currency: 'gbp', payment_intent: 'pi_a', customer: 'cus_9' }, ctx);
  await settle();

  const res = await balanceCheckout(req({ id: b.id, t: b.pay_token }), env, db);
  assert.equal(res.status, 200);
  const s = stripeCalls.at(-1);
  assert.equal(s.params['line_items[0][price_data][unit_amount]'], '53000');
  assert.equal(s.params['metadata[payment_kind]'], 'balance');
  assert.equal(s.params.customer, 'cus_9');

  const bad = await balanceCheckout(req({ id: b.id, t: crypto.randomUUID() }), env, db);
  assert.equal(bad.status, 404);

  await recordSession(env, db, { id: 'cs_b', metadata: { kind: 'retreat', booking_id: b.id, payment_kind: 'balance' }, payment_status: 'paid', amount_total: 53000, currency: 'gbp', payment_intent: 'pi_b' }, ctx);
  await settle();
  assert.equal(DB.tables.retreat_bookings[0].status, 'paid');
  assert.match(emails.at(-1).subject, /You're booked/);

  const again = await balanceCheckout(req({ id: b.id, t: b.pay_token }), env, db);
  assert.equal(again.status, 409);
});

test('editing details before paying updates the same booking instead of creating another', async () => {
  const db = createClient();
  const first = await (await book(req({ ...booker, payment_option: 'full', attendees: twoPeople }), env, db)).json();
  await book(req({ ...booker, payment_option: 'full', attendees: [twoPeople[0]], booking_id: first.booking.id, token: first.booking.token }), env, db);
  assert.equal(DB.tables.retreat_bookings.length, 1);
  assert.equal(DB.tables.retreat_bookings[0].total_amount, 28500);
  assert.equal(DB.tables.retreat_attendees.length, 1);
  // A full-payment checkout lists each room type at its price.
  assert.equal(stripeCalls.at(-1).params['line_items[0][price_data][unit_amount]'], '28500');
});

test('admin invoice: Stripe invoice for the balance; paying it confirms the booking; refunds reopen it', async () => {
  const db = createClient();
  await book(req({ ...booker, payment_option: 'deposit', attendees: [twoPeople[1]] }), env, db);
  const b = DB.tables.retreat_bookings[0];
  await recordSession(env, db, { id: 'cs_a', metadata: { kind: 'retreat', booking_id: b.id, payment_kind: 'deposit' }, payment_status: 'paid', amount_total: 5000, currency: 'gbp', payment_intent: 'pi_a' }, ctx);
  await settle();

  const res = await adminRetreat('/admin/retreat/invoice', req({ booking_id: b.id, days_until_due: 10 }), env, db, 'admin@x', ctx);
  const out = await res.json();
  assert.equal(out.hosted_invoice_url, 'https://invoice.stripe.com/i/1');
  assert.equal(stripeCalls.find((c) => c.path === '/v1/invoiceitems').params.amount, '29500');
  assert.equal(stripeCalls.find((c) => c.path === '/v1/invoices').params.days_until_due, '10');
  assert.equal(DB.tables.retreat_bookings[0].invoice_status, 'open');

  // While the invoice is open, the payment-link route refuses (no double payment) and reminders skip it.
  assert.equal((await balanceCheckout(req({ id: b.id, t: b.pay_token }), env, db)).status, 409);
  const twice = await adminRetreat('/admin/retreat/invoice', req({ booking_id: b.id }), env, db, 'admin@x', ctx);
  assert.equal(twice.status, 409);

  await recordInvoice(env, db, { id: 'in_1', metadata: { kind: 'retreat', booking_id: b.id }, amount_paid: 29500, currency: 'gbp', payment_intent: 'pi_inv' }, ctx);
  await settle();
  assert.equal(DB.tables.retreat_bookings[0].status, 'paid');
  assert.equal(DB.tables.retreat_bookings[0].invoice_status, 'paid');

  await recordRefund(db, 'pi_inv');
  assert.equal(DB.tables.retreat_bookings[0].status, 'deposit_paid');
  assert.equal(DB.tables.retreat_bookings[0].amount_paid, 5000);
});

test('admin manual payment (bank transfer) cannot exceed what is owed', async () => {
  const db = createClient();
  await book(req({ ...booker, payment_option: 'full', attendees: [twoPeople[0]] }), env, db);
  const b = DB.tables.retreat_bookings[0];
  const tooMuch = await adminRetreat('/admin/retreat/manual-payment', req({ booking_id: b.id, amount: 300 }), env, db, 'admin@x', ctx);
  assert.equal(tooMuch.status, 400);
  const ok = await adminRetreat('/admin/retreat/manual-payment', req({ booking_id: b.id, amount: 285, note: 'Bank transfer' }), env, db, 'admin@x', ctx);
  assert.equal(ok.status, 200);
  assert.equal(DB.tables.retreat_bookings[0].status, 'paid');
  assert.equal(DB.tables.retreat_payments[0].recorded_by, 'admin@x');
  assert.match(emails.at(-1).subject, /You're booked/);
});

test('balance reminders at 7 and 14 days after the deposit, once each, never after the retreat starts', async () => {
  const DAY = 864e5;
  const now = Date.parse('2026-12-10T12:00:00Z');
  const b = { id: 'B', deposit_paid_at: new Date(now - 8 * DAY).toISOString() };
  assert.equal(pickReminder(b, new Set(), now), 'balance_reminder_1');
  assert.equal(pickReminder(b, new Set(['B:balance_reminder_1']), now), null);
  assert.equal(pickReminder({ ...b, deposit_paid_at: new Date(now - 15 * DAY).toISOString() }, new Set(['B:balance_reminder_1']), now), 'balance_reminder_2');
  assert.equal(pickReminder({ ...b, deposit_paid_at: new Date(now - 2 * DAY).toISOString() }, new Set(), now), null);

  const db = createClient();
  DB.tables.retreat_bookings.push({ id: crypto.randomUUID(), reference: 'RT-1', first_name: 'A', last_name: 'B', email: 'a@x.test', status: 'deposit_paid', total_amount: 28500, amount_paid: 5000, deposit_paid_at: b.deposit_paid_at, pay_token: crypto.randomUUID() });
  assert.equal((await runRetreatReminders(env, db, now)).sent, 1);
  assert.equal((await runRetreatReminders(env, db, now)).sent, 0);
  assert.equal((await runRetreatReminders(env, db, Date.parse('2026-12-29T00:00:00Z'))).sent, 0);
});

test('names typed into the form cannot inject merge tags or HTML into emails', () => {
  const b = { id: 'B', reference: 'RT-1', first_name: '{{zoom_link}}<b>', last_name: 'X', total_amount: 28500, amount_paid: 5000, pay_token: 'T' };
  const { html } = retreatEmail(env, b, [{ first_name: '<script>', last_name: '{{payment_link}}', room: 'double' }], 'deposit_confirmation');
  assert.doesNotMatch(html, /\{\{|<script>|<b>/);
});

test('audit fixes: test-mode payments are ignored on the live site, names are checked, old payment pages are expired', async () => {
  const db = createClient();
  // Names with digits or links are refused (they would end up in emails).
  const bad = await book(req({ ...booker, first_name: 'Call 0800 000', payment_option: 'full', attendees: [twoPeople[0]] }), env, db);
  assert.equal(bad.status, 400);
  const badAttendee = await book(req({ ...booker, payment_option: 'full', attendees: [{ first_name: 'www.x.com', last_name: 'Y', room: 'double' }] }), env, db);
  assert.equal(badAttendee.status, 400);
  assert.equal((await book(req({ ...booker, first_name: "Zoë-Anne O'Neil", payment_option: 'full', attendees: [twoPeople[0]] }), env, db)).status, 200);

  // A Stripe TEST-mode session never counts as payment on the live site (it does on the preview).
  const b = DB.tables.retreat_bookings.at(-1);
  const testSession = { id: 'cs_test_z', livemode: false, metadata: { kind: 'retreat', booking_id: b.id, payment_kind: 'full' }, payment_status: 'paid', amount_total: 28500, currency: 'gbp' };
  assert.equal(await recordSession(env, db, testSession, ctx), null);
  assert.equal(DB.tables.retreat_payments.length, 0);
  assert.equal((await recordSession({ ...env, PREVIEW: 'true' }, db, testSession, ctx)).status, 'paid');

  // Editing an unpaid booking expires the previous payment page.
  stripeCalls = [];
  const first = await (await book(req({ ...booker, payment_option: 'deposit', attendees: [twoPeople[0]] }), env, db)).json();
  await book(req({ ...booker, payment_option: 'deposit', attendees: twoPeople, booking_id: first.booking.id, token: first.booking.token }), env, db);
  assert.ok(stripeCalls.some((c) => c.path === `/v1/checkout/sessions/${DB.tables.retreat_bookings.find((x) => x.id === first.booking.id) && 'cs_test_1'}/expire`));
});
