import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, createClient } from './helpers/fake-supabase.mjs';
import { nextPayment, instalmentDueDate, paymentSummary, amountDueNow, addMonths, longDate } from '../src/plan.js';
import { runInstalmentReminders, dueKind } from '../src/instalments.js';
import { book, runRetreatReminders } from '../src/retreat.js';

const env = { SITE_URL: 'https://site.example', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b' };
let emails = [];
globalThis.fetch = async (_u, init) => { const b = JSON.parse(init.body); emails.push(...b); return Response.json({ data: b.map((_, i) => ({ id: 'e' + i })) }); };
beforeEach(() => { for (const t of Object.keys(DB.tables)) DB.tables[t] = []; emails = []; });

const DAY = 864e5;
const paidAt = '2026-11-12T10:00:00Z';
const reg = (o = {}) => ({ id: 'R1', first_name: 'Ada', last_name: 'Obi', email: 'ada@example.test', pay_token: 'tok', status: 'paid', payment_plan: 'instalments', amount_due: 15000, amount_paid: 5000, paid_at: paidAt, ...o });

test('plan: £50 now, then £50 a month later and two months later', () => {
  assert.deepEqual(nextPayment(reg({ status: 'pending', amount_paid: 0, paid_at: null })), { amount: 5000, instalment: 1, balance: 15000 });
  assert.deepEqual(nextPayment(reg()), { amount: 5000, instalment: 2, balance: 10000 });
  assert.deepEqual(nextPayment(reg({ amount_paid: 10000 })), { amount: 5000, instalment: 3, balance: 5000 });
  assert.equal(nextPayment(reg({ amount_paid: 15000 })), null);
  assert.equal(nextPayment(reg({ payment_plan: 'full', amount_paid: 15000 })), null);
  assert.deepEqual(nextPayment(reg({ payment_plan: 'full', status: 'pending', amount_paid: null })), { amount: 15000, instalment: null, balance: 15000 });
  assert.equal(longDate(instalmentDueDate(reg(), 2)), '12 December 2026');
  assert.equal(longDate(instalmentDueDate(reg(), 3)), '12 January 2027');
  assert.equal(addMonths('2027-01-31T12:00:00Z', 1).toISOString().slice(0, 10), '2027-02-28');
});

test('email wording follows the plan', () => {
  assert.equal(paymentSummary(reg({ payment_plan: 'full', amount_paid: 15000 })), 'your payment of £150 has been received');
  assert.match(paymentSummary(reg()), /first instalment of £50 has been received \(the remaining £50 instalments are due on 12 December 2026 and 12 January 2027\)/);
  assert.equal(amountDueNow(reg({ status: 'pending', amount_paid: 0 })), '£50');
  assert.equal(amountDueNow(reg({ payment_plan: 'full', status: 'pending', amount_paid: 0 })), '£150');
});

test('instalment emails: due on the date, reminder 3 days later, each once; nothing before the date or once paid', async () => {
  const due2 = Date.parse('2026-12-12T10:00:00Z');
  assert.equal(dueKind(reg(), new Set(), due2 - DAY), null);
  assert.equal(dueKind(reg(), new Set(), due2), 'due');
  assert.equal(dueKind(reg(), new Set(['R1:instalment_2_due']), due2 + DAY), null);
  assert.equal(dueKind(reg(), new Set(['R1:instalment_2_due']), due2 + 3 * DAY), 'reminder');

  const db = createClient();
  DB.tables.registrants.push(reg(), reg({ id: 'R2', email: 'full@example.test', payment_plan: 'full', amount_paid: 15000 }), reg({ id: 'R3', email: 'done@example.test', amount_paid: 15000 }));
  assert.equal((await runInstalmentReminders(env, db, due2)).sent, 1);
  assert.equal(emails[0].to[0], 'ada@example.test');
  assert.match(emails[0].subject, /due today/);
  assert.match(emails[0].html, /PAY INSTALMENT 2 OF 3 \(£50\)/);
  assert.match(emails[0].html, /https:\/\/site\.example\/api\/pay\?id=R1&amp;t=tok/);
  assert.equal((await runInstalmentReminders(env, db, due2 + DAY)).sent, 0);
  assert.equal((await runInstalmentReminders(env, db, due2 + 3 * DAY)).sent, 1);
  assert.match(emails[1].subject, /Reminder/);
  assert.equal((await runInstalmentReminders(env, db, due2 + 4 * DAY)).sent, 0);
});

test('retreat postponed: no bookings, no balance reminders', async () => {
  const db = createClient();
  const res = await book(new Request('https://x/', { method: 'POST', body: '{}' }), env, db);
  assert.equal(res.status, 410);
  assert.match((await res.json()).error, /postponed/);
  DB.tables.retreat_bookings.push({ id: 'B', reference: 'RT-1', first_name: 'A', last_name: 'B', email: 'a@x.test', status: 'deposit_paid', total_amount: 34500, amount_paid: 5000, deposit_paid_at: '2026-11-03T23:05:23Z', pay_token: 't' });
  assert.equal((await runRetreatReminders(env, db, Date.parse('2026-11-17T23:10:00Z'))).sent, 0);
  assert.equal(emails.length, 0);
});
