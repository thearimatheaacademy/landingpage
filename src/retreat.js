// End of Year Retreat: bookings for one or more attendees, paid in full or with a deposit,
// with the balance paid later through an emailed link or a Stripe invoice sent from the dashboard.
import { createRetreatSession, sendRetreatInvoice, stripeRequest } from './stripe.js';
import { deliver, loadSettings, escapeHtml, unwrap } from './email.js';

const isName = (v) => /^[\p{L}\p{M}][\p{L}\p{M} '’-]{0,59}$/u.test(v);
const countsAsPayment = (env, obj) => obj?.livemode !== false || env.PREVIEW === 'true';

// ── Prices (pence). The server is the only place prices come from. ──
export const ROOMS = {
  double: { price: 28500, name: 'Double occupancy', blurb: 'Shared room with one other attendee' },
  single: { price: 34500, name: 'Single occupancy', blurb: 'Private room' },
};
export const DEPOSIT_PER_PERSON = 5000;
export const MAX_ATTENDEES = 10;
export const RETREAT_STARTS = Date.parse('2026-12-28T00:00:00Z');
const RETREAT_NAME = 'End of Year Retreat';
const RETREAT_WHEN = 'Monday 28 to Thursday 31 December 2026, Leicestershire';
const FOOTER = 'The Arimathea Academy · End of Year Retreat · thearimatheaacademy.com';
const DAY = 24 * 3600 * 1000;

export const gbp = (pence) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Works out what a booking costs and what is due now. Throws a user-facing Error on bad input.
export function quote(attendees, paymentOption) {
  if (!Array.isArray(attendees) || attendees.length < 1) throw new Error('Please add at least one attendee.');
  if (attendees.length > MAX_ATTENDEES) throw new Error(`You can book up to ${MAX_ATTENDEES} people at once. For larger groups, please contact us.`);
  if (!['full', 'deposit'].includes(paymentOption)) throw new Error('Please choose how you would like to pay.');
  const counts = { double: 0, single: 0 };
  for (const a of attendees) {
    if (!ROOMS[a.room]) throw new Error('Please choose a room for every attendee.');
    counts[a.room]++;
  }
  const total = counts.double * ROOMS.double.price + counts.single * ROOMS.single.price;
  const deposit = attendees.length * DEPOSIT_PER_PERSON;
  return { counts, total, deposit, dueNow: paymentOption === 'deposit' ? deposit : total };
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v || '');
// User text goes into email templates; stop it from being read as a {{merge_tag}}.
const safe = (s) => escapeHtml(s ?? '').replace(/[{}]/g, (c) => (c === '{' ? '&#123;' : '&#125;'));

// Shape returned to the booking page (no internal ids beyond the booking's own id and token).
export function publicBooking(b, attendees) {
  return {
    id: b.id,
    token: b.pay_token,
    reference: b.reference,
    first_name: b.first_name,
    last_name: b.last_name,
    email: b.email,
    payment_option: b.payment_option,
    status: b.status,
    total: b.total_amount,
    deposit: b.deposit_amount,
    paid: b.amount_paid,
    outstanding: Math.max(0, b.total_amount - b.amount_paid),
    attendees: (attendees || []).map((a) => ({ first_name: a.first_name, last_name: a.last_name, room: a.room, unit_price: a.unit_price })),
  };
}

// ── POST /api/retreat/book ── step 1 of the booking form. Creates (or, for a booking the same
// browser started and hasn't paid, replaces) the booking, then returns an Embedded Checkout secret.
export async function book(request, env, db) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ error: 'Invalid submission' }, 400); // honeypot

  const booker = {
    first_name: clean(body.first_name, 100),
    last_name: clean(body.last_name, 100),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40) || null,
    special_requests: clean(body.special_requests, 2000) || null,
    marketing_consent: body.marketing_consent === true,
    payment_option: body.payment_option,
  };
  if (!booker.first_name || !booker.last_name) return json({ error: 'Please enter your first and last name.' }, 400);
  if (!isName(booker.first_name) || !isName(booker.last_name)) return json({ error: 'Please use only letters, spaces, hyphens and apostrophes in names.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booker.email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (!booker.phone || booker.phone.replace(/\D/g, '').length < 7) return json({ error: 'Please enter your phone / WhatsApp number.' }, 400);
  if (body.accept_terms !== true) return json({ error: 'Please accept the terms to continue.' }, 400);

  const attendees = (Array.isArray(body.attendees) ? body.attendees : []).map((a, i) => ({
    position: i + 1,
    first_name: clean(a?.first_name, 100),
    last_name: clean(a?.last_name, 100),
    room: a?.room,
    dietary: clean(a?.dietary, 500) || null,
  }));
  if (attendees.some((a) => !a.first_name || !a.last_name)) return json({ error: 'Please enter a first and last name for every attendee.' }, 400);
  if (attendees.some((a) => !isName(a.first_name) || !isName(a.last_name))) return json({ error: 'Please use only letters, spaces, hyphens and apostrophes in names.' }, 400);
  let q;
  try { q = quote(attendees, booker.payment_option); } catch (e) { return json({ error: e.message }, 400); }

  const row = { ...booker, total_amount: q.total, deposit_amount: q.deposit };
  let booking = null;
  // Going back from the payment step to edit details: update the same unpaid booking, but only with its token.
  if (isUuid(body.booking_id) && isUuid(body.token)) {
    const { data: existing } = await db.from('retreat_bookings').select('*').eq('id', body.booking_id).eq('pay_token', body.token).maybeSingle();
    if (existing && existing.status === 'pending' && existing.amount_paid === 0) {
      // The earlier payment page must not stay payable for the old (possibly cheaper) booking.
      await expireSession(env, existing.stripe_session_id);
      booking = await db.from('retreat_bookings').update(row).eq('id', existing.id).select().single().then(unwrap);
      await db.from('retreat_attendees').delete().eq('booking_id', existing.id).then(unwrap);
    }
  }
  if (!booking) booking = await db.from('retreat_bookings').insert(row).select().single().then(unwrap);

  const rows = attendees.map((a) => ({ ...a, booking_id: booking.id, unit_price: ROOMS[a.room].price }));
  await db.from('retreat_attendees').insert(rows).then(unwrap);

  const session = await checkoutFor(env, booking, rows, booker.payment_option === 'deposit' ? 'deposit' : 'full');
  await db.from('retreat_bookings').update({ stripe_session_id: session.id }).eq('id', booking.id);
  return json({ client_secret: session.client_secret, booking: publicBooking(booking, rows), due_now: q.dueNow });
}

// ── GET /api/retreat/booking?id&t ── what the balance page shows.
export async function getBooking(url, db) {
  const found = await findByToken(db, url.searchParams.get('id'), url.searchParams.get('t'));
  if (!found) return json({ error: 'We could not find that booking. Please use the link in your email, or contact us.' }, 404);
  return json({ booking: publicBooking(found.booking, found.attendees) });
}

// ── POST /api/retreat/checkout {id, t} ── pay whatever is outstanding (balance link in emails).
export async function balanceCheckout(request, env, db) {
  const { id, t } = await request.json().catch(() => ({}));
  const found = await findByToken(db, id, t);
  if (!found) return json({ error: 'We could not find that booking. Please use the link in your email, or contact us.' }, 404);
  const { booking, attendees } = found;
  if (['refunded', 'cancelled'].includes(booking.status)) return json({ error: 'This booking has been cancelled. Please contact us if you would like to book again.' }, 409);
  const outstanding = booking.total_amount - booking.amount_paid;
  if (outstanding <= 0) return json({ error: 'This booking is already paid in full. Thank you!', booking: publicBooking(booking, attendees) }, 409);
  // Avoid paying twice: an open invoice has its own Stripe payment page.
  if (booking.invoice_status === 'open') return json({ error: 'We have emailed you an invoice for this balance. Please pay using the link in that invoice email, or contact us.', booking: publicBooking(booking, attendees) }, 409);

  // An unpaid booking resumes its original choice; a part-paid one pays the balance.
  const kind = booking.amount_paid === 0 ? (booking.payment_option === 'deposit' ? 'deposit' : 'full') : 'balance';
  const session = await checkoutFor(env, booking, attendees, kind);
  await db.from('retreat_bookings').update({ stripe_session_id: session.id }).eq('id', booking.id);
  return json({ client_secret: session.client_secret, booking: publicBooking(booking, attendees), due_now: dueFor(booking, attendees, kind) });
}

function dueFor(booking, attendees, kind) {
  if (kind === 'deposit') return attendees.length * DEPOSIT_PER_PERSON;
  return booking.total_amount - booking.amount_paid;
}

function checkoutFor(env, booking, attendees, kind) {
  const returnUrl = `${env.SITE_URL}/api/retreat/return?session_id={CHECKOUT_SESSION_ID}`;
  let lines;
  if (kind === 'full') {
    lines = Object.entries(ROOMS)
      .map(([room, r]) => ({ room, r, qty: attendees.filter((a) => a.room === room).length }))
      .filter((x) => x.qty)
      .map(({ r, qty }) => ({ name: `${RETREAT_NAME}: ${r.name}`, description: `${RETREAT_WHEN}. ${r.blurb}.`, amount: r.price, quantity: qty }));
  } else if (kind === 'deposit') {
    lines = [{
      name: `${RETREAT_NAME}: deposit (non-refundable)`,
      description: `Secures ${attendees.length === 1 ? 'one place' : `${attendees.length} places`}. Balance of ${gbp(booking.total_amount - booking.deposit_amount)} to pay later.`,
      amount: DEPOSIT_PER_PERSON,
      quantity: attendees.length,
    }];
  } else {
    lines = [{ name: `${RETREAT_NAME}: balance`, description: `Booking ${booking.reference}. ${RETREAT_WHEN}.`, amount: booking.total_amount - booking.amount_paid, quantity: 1 }];
  }
  return createRetreatSession(env, booking, { lines, paymentKind: kind, returnUrl });
}

// Expire an open Checkout Session (ignored if it is already paid, expired or missing).
async function expireSession(env, id) {
  if (!id) return;
  await stripeRequest(env, 'POST', `/v1/checkout/sessions/${id}/expire`).catch(() => {});
}

async function findByToken(db, id, t) {
  if (!isUuid(id) || !isUuid(t)) return null;
  const { data: booking } = await db.from('retreat_bookings').select('*').eq('id', id).eq('pay_token', t).maybeSingle();
  if (!booking) return null;
  const attendees = await db.from('retreat_attendees').select('*').eq('booking_id', id).order('position').then(unwrap);
  return { booking, attendees };
}

// ── Payments ────────────────────────────────────────────────
// Records a paid Checkout Session (from the webhook or the return page; whichever comes first wins).
// Sends the right email only from the call that actually recorded the payment.
export async function recordSession(env, db, session, ctx) {
  if (session.metadata?.kind !== 'retreat' || session.payment_status !== 'paid' || !countsAsPayment(env, session)) return null;
  const bookingId = session.metadata.booking_id || session.client_reference_id;
  if (!isUuid(bookingId)) return null;
  const kind = ['deposit', 'full', 'balance'].includes(session.metadata.payment_kind) ? session.metadata.payment_kind : 'balance';
  const result = await recordPayment(db, {
    booking: bookingId, kind, amount: session.amount_total, currency: session.currency,
    session: session.id, intent: session.payment_intent,
  });
  if (session.customer && !result.booking.stripe_customer_id) {
    await db.from('retreat_bookings').update({ stripe_customer_id: session.customer }).eq('id', bookingId);
    result.booking.stripe_customer_id = session.customer;
  }
  if (result.inserted) ctx.waitUntil(afterPayment(env, db, result.booking).catch((e) => console.error('retreat after payment', e)));
  return result.booking;
}

// invoice.paid webhook for invoices sent from the dashboard.
export async function recordInvoice(env, db, invoice, ctx) {
  if (invoice.metadata?.kind !== 'retreat' || !isUuid(invoice.metadata.booking_id) || !invoice.amount_paid || !countsAsPayment(env, invoice)) return null;
  const result = await recordPayment(db, {
    booking: invoice.metadata.booking_id, kind: 'invoice', amount: invoice.amount_paid, currency: invoice.currency,
    invoice: invoice.id, intent: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id,
  });
  if (result.booking.stripe_invoice_id === invoice.id) {
    await db.from('retreat_bookings').update({ invoice_status: 'paid' }).eq('id', result.booking.id);
    result.booking.invoice_status = 'paid'; // so afterPayment doesn't try to void the invoice just paid
  }
  if (result.inserted) ctx.waitUntil(afterPayment(env, db, result.booking).catch((e) => console.error('retreat after invoice', e)));
  return result.booking;
}

export async function recordRefund(db, paymentIntent) {
  if (!paymentIntent) return;
  const { error } = await db.rpc('refund_retreat_payment', { p_intent: paymentIntent });
  if (error) throw error;
}

async function recordPayment(db, p) {
  const { data, error } = await db.rpc('record_retreat_payment', {
    p_booking: p.booking, p_kind: p.kind, p_amount: p.amount, p_currency: p.currency || 'gbp',
    p_session: p.session || null, p_invoice: p.invoice || null, p_intent: p.intent || null,
    p_note: p.note || null, p_recorded_by: p.recordedBy || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { booking: row.booking, inserted: row.inserted };
}

// After any new payment: send the matching confirmation, and void an open invoice if nothing is owed.
async function afterPayment(env, db, booking) {
  if (booking.status === 'paid' && booking.stripe_invoice_id && booking.invoice_status === 'open') {
    await stripeRequest(env, 'POST', `/v1/invoices/${booking.stripe_invoice_id}/void`).catch((e) => console.error('void invoice', e));
    await db.from('retreat_bookings').update({ invoice_status: 'void' }).eq('id', booking.id);
  }
  if (booking.status === 'paid') return sendRetreatEmail(env, db, booking, 'paid_confirmation');
  if (booking.status === 'deposit_paid') return sendRetreatEmail(env, db, booking, 'deposit_confirmation');
}

// ── Emails ──────────────────────────────────────────────────
export function balanceLink(env, booking) {
  return `${env.SITE_URL}/retreat/book/?id=${booking.id}&t=${booking.pay_token}`;
}

const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#23571F;color:#FBF5E3;padding:14px 26px;text-decoration:none;font-weight:600">${label}</a></p>`;

export function retreatEmail(env, booking, attendees, template) {
  const name = safe(booking.first_name);
  const list = `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:15px">${attendees
    .map((a) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${safe(a.first_name)} ${safe(a.last_name)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${ROOMS[a.room]?.name || safe(a.room)}</td></tr>`)
    .join('')}</table>`;
  const owed = booking.total_amount - booking.amount_paid;
  const money = `<p><strong>Booking reference:</strong> ${safe(booking.reference)}<br><strong>Total:</strong> ${gbp(booking.total_amount)}<br><strong>Paid so far:</strong> ${gbp(booking.amount_paid)}${owed > 0 ? `<br><strong>Balance to pay:</strong> ${gbp(owed)}` : ''}</p>`;
  const when = `<p><strong>When:</strong> Monday 28 to Thursday 31 December 2026<br><strong>Where:</strong> Leicestershire</p>`;
  const sign = '<p>With love,<br>Coach Collins and The Arimathea Academy</p>';
  const link = balanceLink(env, booking);

  switch (template) {
    case 'deposit_confirmation':
      return {
        subject: `Your retreat place is reserved (${booking.reference})`,
        html: `<p>Dear ${name},</p><p>Thank you, your deposit has been received and your place${attendees.length > 1 ? 's are' : ' is'} reserved for the <strong>${RETREAT_NAME}</strong>.</p>${when}${list}${money}<p>You can pay the balance at any time using the button below. The deposit is non-refundable.</p>${button(link, `PAY YOUR BALANCE (${gbp(owed)})`)}<p>If you have any questions, reply to this email or call or WhatsApp us on 07412 045045.</p>${sign}`,
      };
    case 'paid_confirmation':
      return {
        subject: `You're booked: End of Year Retreat (${booking.reference})`,
        html: `<p>Dear ${name},</p><p>Thank you, your booking for the <strong>${RETREAT_NAME}</strong> is paid in full and confirmed.</p>${when}${list}${money}<p>We will be in touch with the venue details and everything you need to know before the retreat.</p><p>If you have any questions, reply to this email or call or WhatsApp us on 07412 045045.</p>${sign}`,
      };
    case 'balance_link':
    case 'balance_reminder_1':
    case 'balance_reminder_2':
      return {
        subject: template === 'balance_reminder_2' ? `Reminder: your retreat balance (${booking.reference})` : `Pay your retreat balance (${booking.reference})`,
        html: `<p>Dear ${name},</p><p>${template === 'balance_link' ? 'Here is the link to pay the balance for your' : 'A friendly reminder that there is a balance to pay on your'} <strong>${RETREAT_NAME}</strong> booking.</p>${when}${list}${money}${button(link, `PAY ${gbp(owed)} NOW`)}<p>If you have already arranged payment with us, please ignore this email.</p>${sign}`,
      };
    default:
      throw new Error(`Unknown retreat email ${template}`);
  }
}

export async function sendRetreatEmail(env, db, booking, template) {
  const attendees = await db.from('retreat_attendees').select('*').eq('booking_id', booking.id).order('position').then(unwrap);
  const { subject, html } = retreatEmail(env, booking, attendees, template);
  const [row] = await deliver(env, db, await loadSettings(db), [{
    to: { email: booking.email, first_name: booking.first_name, last_name: booking.last_name },
    kind: 'retreat', booking_id: booking.id, template, subject, html, footer: FOOTER,
  }]);
  return row;
}

// Cron: remind deposit payers about their balance 7 and 14 days after the deposit, before the retreat.
// Skips bookings that have an open invoice (they already have a way to pay).
export async function runRetreatReminders(env, db, now = Date.now()) {
  if (now >= RETREAT_STARTS) return { sent: 0 };
  const due = await db.from('retreat_bookings').select('*').eq('status', 'deposit_paid').then(unwrap);
  if (!due.length) return { sent: 0 };
  const logged = await db.from('email_log').select('booking_id, template').eq('kind', 'retreat').eq('status', 'sent')
    .in('booking_id', due.map((b) => b.id)).then(unwrap);
  const done = new Set(logged.map((l) => `${l.booking_id}:${l.template}`));
  let sent = 0;
  for (const b of due) {
    if (b.invoice_status === 'open') continue;
    const template = pickReminder(b, done, now);
    if (!template) continue;
    const row = await sendRetreatEmail(env, db, b, template);
    if (row?.status === 'sent') sent++;
  }
  return { sent };
}

export function pickReminder(booking, done, now) {
  const since = now - Date.parse(booking.deposit_paid_at);
  if (!(since >= 0)) return null;
  if (since >= 14 * DAY && !done.has(`${booking.id}:balance_reminder_2`)) return done.has(`${booking.id}:balance_reminder_1`) ? 'balance_reminder_2' : 'balance_reminder_1';
  if (since >= 7 * DAY && !done.has(`${booking.id}:balance_reminder_1`)) return 'balance_reminder_1';
  return null;
}

// ── Admin actions ───────────────────────────────────────────
export async function adminRetreat(api, request, env, db, adminEmail, ctx) {
  const body = await request.json().catch(() => ({}));
  if (!isUuid(body.booking_id)) return json({ error: 'Missing booking' }, 400);
  const booking = await db.from('retreat_bookings').select('*').eq('id', body.booking_id).maybeSingle().then(unwrap);
  if (!booking) return json({ error: 'Booking not found' }, 404);
  const owed = booking.total_amount - booking.amount_paid;

  if (api === '/admin/retreat/send-link') {
    if (owed <= 0) return json({ error: 'Nothing left to pay on this booking.' }, 400);
    const row = await sendRetreatEmail(env, db, booking, 'balance_link');
    return row.status === 'sent' ? json({ ok: true }) : json({ error: row.error || 'Email failed' }, 502);
  }

  if (api === '/admin/retreat/invoice') {
    const amount = body.amount == null ? owed : Math.round(Number(body.amount) * 100);
    if (!(amount > 0) || amount > owed) return json({ error: `Invoice amount must be between £0.01 and ${gbp(owed)}.` }, 400);
    if (booking.invoice_status === 'open') return json({ error: `Invoice ${booking.stripe_invoice_id} is still open. Void it in Stripe first, or wait for it to be paid.` }, 409);
    const days = Math.min(60, Math.max(1, Number(body.days_until_due) || 7));
    const description = clean(body.description, 200) || `End of Year Retreat balance, booking ${booking.reference}`;
    await expireSession(env, booking.stripe_session_id); // an open balance page must not be paid as well as the invoice
    const { customer, invoice } = await sendRetreatInvoice(env, booking, { amount, description, daysUntilDue: days });
    await db.from('retreat_bookings').update({ stripe_customer_id: customer, stripe_invoice_id: invoice.id, invoice_status: invoice.status }).eq('id', booking.id);
    return json({ ok: true, invoice_id: invoice.id, hosted_invoice_url: invoice.hosted_invoice_url, status: invoice.status });
  }

  if (api === '/admin/retreat/manual-payment') {
    // e.g. bank transfer or cash received outside Stripe
    const amount = Math.round(Number(body.amount) * 100);
    if (!(amount > 0) || amount > owed) return json({ error: `Amount must be between £0.01 and ${gbp(owed)}.` }, 400);
    const note = clean(body.note, 200) || 'Recorded manually';
    const result = await recordPayment(db, { booking: booking.id, kind: 'manual', amount, note, recordedBy: adminEmail });
    if (body.send_email !== false) await afterPayment(env, db, result.booking);
    return json({ ok: true, booking: result.booking });
  }

  if (api === '/admin/retreat/sync') {
    // Safety net for a missed webhook: re-check this booking's latest Checkout Session.
    if (!booking.stripe_session_id) return json({ updated: false });
    const session = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${booking.stripe_session_id}`);
    const before = booking.amount_paid;
    const after = await recordSession(env, db, session, ctx);
    return json({ updated: !!after && after.amount_paid !== before });
  }

  return json({ error: 'Not found' }, 404);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
