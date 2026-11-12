// Bootcamp instalment emails: "due today", a reminder 3 days later, and a receipt after each later payment.
// The payment button is the registrant's own {{payment_link}}, which opens /register/ at the next instalment.
import { deliver, loadSettings, unwrap } from './email.js';
import { INSTALMENTS, gbp, longDate, nextPayment, instalmentDueDate } from './plan.js';

const DAY = 24 * 3600 * 1000;
const REMINDER_AFTER_DAYS = 3;

const button = (label) =>
  `<p style="margin:24px 0"><a href="{{payment_link}}" style="background:#23571F;color:#FBF5E3;padding:14px 26px;text-decoration:none;font-weight:600">${label}</a></p>`;
const sign = '<p>The Arimathea Academy</p>';

export function instalmentEmail(r, kind) {
  const next = nextPayment(r);
  const paid = r.amount_paid || 0;
  const total = r.amount_due;
  if (kind === 'receipt') {
    const left = next
      ? `<p>Your next instalment of <strong>${gbp(next.amount)}</strong> is due on <strong>${longDate(instalmentDueDate(r, next.instalment))}</strong>. We will email you a payment link that day.</p>`
      : `<p>That was your final instalment. Your ${gbp(total)} fee is now <strong>fully paid</strong>. Thank you!</p>`;
    return {
      subject: next ? 'Instalment received: Kingdom School Bootcamp' : 'Fully paid: Kingdom School Bootcamp',
      html: `<p>Dear {{first_name}},</p><p>Thank you, we have received your instalment for the <strong>Kingdom School of Business &amp; Ministry Bootcamp</strong>.</p><p><strong>Paid so far:</strong> ${gbp(paid)} of ${gbp(total)}</p>${left}${sign}`,
    };
  }
  if (!next) return null;
  const label = `PAY INSTALMENT ${next.instalment} OF ${INSTALMENTS} (${gbp(next.amount)})`;
  const facts = `<p><strong>Paid so far:</strong> ${gbp(paid)} of ${gbp(total)}<br><strong>This instalment:</strong> ${gbp(next.amount)}</p>`;
  if (kind === 'reminder') {
    return {
      subject: 'Reminder: your Kingdom School instalment',
      html: `<p>Dear {{first_name}},</p><p>A friendly reminder that instalment ${next.instalment} of ${INSTALMENTS} for the Kingdom School of Business &amp; Ministry Bootcamp was due on ${longDate(instalmentDueDate(r, next.instalment))} and hasn't been paid yet.</p>${facts}${button(label)}<p>If you've already paid or need to talk about it, just reply to this email.</p>${sign}`,
    };
  }
  // 'due' (automatic, on the due date) and 'link' (sent by an admin)
  return {
    subject: kind === 'due' ? 'Your Kingdom School instalment is due today' : 'Pay your Kingdom School instalment',
    html: `<p>Dear {{first_name}},</p><p>${kind === 'due' ? 'Your next' : 'Here is the link for your next'} instalment for the <strong>Kingdom School of Business &amp; Ministry Bootcamp</strong>${kind === 'due' ? ' is due today' : ''}.</p>${facts}${button(label)}${sign}`,
  };
}

// kind: 'due' | 'reminder' | 'receipt' | 'link'. Automatic ones are logged once per instalment (template name).
export async function sendInstalmentEmail(env, db, r, kind, settings) {
  const content = instalmentEmail(r, kind);
  if (!content) return null;
  const next = nextPayment(r);
  const n = kind === 'receipt' ? Math.round((r.amount_paid || 0) / 5000) : next?.instalment;
  const [row] = await deliver(env, db, settings || (await loadSettings(db)), [{
    registrant: r,
    kind: kind === 'link' ? 'manual' : 'instalment',
    template: kind === 'link' ? null : `instalment_${n}_${kind}`,
    subject: content.subject,
    html: content.html,
  }]);
  return row;
}

// Cron: on each instalment's due date send "due today", and 3 days later a reminder if still unpaid.
export async function runInstalmentReminders(env, db, now = Date.now()) {
  const owing = (await db.from('registrants').select('*').eq('payment_plan', 'instalments').eq('status', 'paid').then(unwrap))
    .filter((r) => nextPayment(r) && r.paid_at);
  if (!owing.length) return { sent: 0 };
  const logged = await db.from('email_log').select('registrant_id, template').eq('kind', 'instalment').eq('status', 'sent')
    .in('registrant_id', owing.map((r) => r.id)).then(unwrap);
  const done = new Set(logged.map((l) => `${l.registrant_id}:${l.template}`));
  const settings = await loadSettings(db);
  let sent = 0;
  for (const r of owing) {
    const kind = dueKind(r, done, now);
    if (!kind) continue;
    const row = await sendInstalmentEmail(env, db, r, kind, settings);
    if (row?.status === 'sent') sent++;
  }
  return { sent };
}

export function dueKind(r, done, now) {
  const next = nextPayment(r);
  if (!next || next.instalment < 2) return null;
  const due = instalmentDueDate(r, next.instalment).getTime();
  const key = (k) => `${r.id}:instalment_${next.instalment}_${k}`;
  if (now >= due + REMINDER_AFTER_DAYS * DAY && !done.has(key('reminder'))) return done.has(key('due')) ? 'reminder' : 'due';
  if (now >= due && !done.has(key('due'))) return 'due';
  return null;
}
