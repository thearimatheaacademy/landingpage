// Bootcamp payment plans. The server is the only place amounts and dates come from.
//   full:        £150 in one payment
//   instalments: £50 now, £50 one month later, £50 two months later (dates count from the first payment)

export const FEE = 15000;
export const INSTALMENT = 5000;
export const INSTALMENTS = 3;

export const gbp = (pence) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Same day of the month, n months later (31 Jan + 1 month = 28/29 Feb).
export function addMonths(when, n) {
  const d = new Date(when);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export const longDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

// What this registrant should pay next, or null if nothing is owed.
export function nextPayment(r) {
  const due = r.amount_due || FEE;
  if (r.payment_plan !== 'instalments') return r.status === 'paid' ? null : { amount: due, instalment: null, balance: due };
  const paid = r.amount_paid || 0;
  const balance = due - paid;
  if (balance <= 0) return null;
  return { amount: Math.min(INSTALMENT, balance), instalment: Math.floor(paid / INSTALMENT) + 1, balance };
}

// Due date of instalment n (1-based). Instalment 1 is the day they first paid (or today, before they pay).
export function instalmentDueDate(r, n, now = Date.now()) {
  return addMonths(r.paid_at || now, n - 1);
}

// Text for the "{{payment_summary}}" merge tag in the confirmation email.
export function paymentSummary(r) {
  if (r.payment_plan !== 'instalments') return `your payment of ${gbp(r.amount_due || FEE)} has been received`;
  const paid = r.amount_paid || 0;
  const due = r.amount_due || FEE;
  if (paid >= due) return `your final instalment has been received, so your ${gbp(due)} fee is fully paid,`;
  const next = nextPayment(r);
  const remaining = [];
  for (let n = next.instalment; n <= INSTALMENTS; n++) remaining.push(longDate(instalmentDueDate(r, n)));
  return `your first instalment of ${gbp(paid)} has been received (the remaining ${gbp(INSTALMENT)} instalments are due on ${remaining.join(' and ')})`;
}

// Text for "{{amount_due_now}}" in the unpaid-registration reminders.
export const amountDueNow = (r) => gbp(nextPayment(r)?.amount ?? (r.amount_due || FEE));
