// Test-only in-memory stand-in for @supabase/supabase-js (subset used by the Worker).
// Minimal in-memory stand-in for @supabase/supabase-js (enough for the Worker's queries).
export const DB = { tables: { registrants: [], email_log: [], email_sequence_steps: [], email_campaigns: [], settings: [], admins: [], retreat_bookings: [], retreat_attendees: [], retreat_payments: [] }, users: [], failBatchWithDup: false };
let seq = 1;
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.one = null; this.rng = null; this.head = false; }
  select(_c, o) { if (this.op === 'select') this.op = 'select'; this.ret = true; if (o?.head) this.head = true; return this; }
  eq(k, v) { this.f.push((r) => String(r[k]).toLowerCase() === String(v).toLowerCase()); return this; }
  neq(k, v) { this.f.push((r) => r[k] !== v); return this; }
  in(k, vs) { this.f.push((r) => vs.includes(r[k])); return this; }
  gte(k, v) { this.f.push((r) => r[k] >= v); return this; }
  lte(k, v) { this.f.push((r) => r[k] <= v); return this; }
  not() { return this; }
  order() { return this; }
  limit() { return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  update(p) { this.op = 'update'; this.patch = p; return this; }
  insert(rows) { this.op = 'insert'; this.rows = rows; return this; }
  delete() { this.op = 'delete'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    const T = DB.tables[this.t];
    if (this.op === 'insert') {
      const rows = Array.isArray(this.rows) ? this.rows : [this.rows];
      if (this.t === 'email_log') {
        const key = (r) => `${r.registrant_id}|${r.kind}|${r.ref_id}`;
        const sent = new Set(T.filter((r) => r.status === 'sent' && ['sequence', 'campaign'].includes(r.kind)).map(key));
        if (rows.some((r) => r.status === 'sent' && ['sequence', 'campaign'].includes(r.kind) && sent.has(key(r)))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const extra = this.t === 'retreat_bookings' ? { amount_paid: 0, reference: 'RT-' + String(seq++).padStart(6, '0') } : {};
      const made = rows.map((r) => ({ id: this.t === 'email_log' ? seq++ : crypto.randomUUID(), status: 'pending', pay_token: crypto.randomUUID(), created_at: new Date().toISOString(), ...extra, ...r }));
      T.push(...made);
      return { data: this.one ? made[0] : made, error: null };
    }
    let rows = T.filter((r) => this.f.every((f) => f(r)));
    if (this.op === 'delete') { DB.tables[this.t] = T.filter((r) => !rows.includes(r)); return { data: null, error: null }; }
    if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.patch)); }
    if (this.head) return { count: rows.length, data: null, error: null };
    if (this.rng) rows = rows.slice(this.rng[0], Math.min(this.rng[1] + 1, this.rng[0] + 1000));
    else if (this.op === 'select') rows = rows.slice(0, 1000); // PostgREST max_rows
    if (this.one) return { data: rows[0] ?? null, error: this.one === 'single' && !rows[0] ? { message: 'no row' } : null };
    return { data: rows, error: null };
  }
}
// Same rules as private.record_retreat_payment / refund_retreat_payment in 0005_retreat.sql.
function recalc(id) {
  const b = DB.tables.retreat_bookings.find((x) => x.id === id);
  const ps = DB.tables.retreat_payments.filter((p) => p.booking_id === id);
  const paid = ps.filter((p) => p.status === 'succeeded').reduce((n, p) => n + p.amount, 0);
  const refunded = ps.some((p) => p.status === 'refunded');
  b.amount_paid = paid;
  b.status = paid >= b.total_amount ? 'paid' : paid > 0 ? 'deposit_paid' : refunded ? 'refunded' : ['deposit_paid', 'paid'].includes(b.status) ? 'pending' : b.status;
  if (paid > 0) b.deposit_paid_at ??= new Date().toISOString();
  b.paid_at = paid >= b.total_amount ? (b.paid_at ?? new Date().toISOString()) : null;
  return { ...b };
}
const rpcs = {
  record_retreat_payment(a) {
    if (!DB.tables.retreat_bookings.some((b) => b.id === a.p_booking)) return { data: null, error: { message: 'not found' } };
    const dup = DB.tables.retreat_payments.some((p) => (a.p_session && p.stripe_session_id === a.p_session) || (a.p_invoice && p.stripe_invoice_id === a.p_invoice));
    if (!dup) DB.tables.retreat_payments.push({ id: crypto.randomUUID(), booking_id: a.p_booking, kind: a.p_kind, amount: a.p_amount, currency: a.p_currency, status: 'succeeded', stripe_session_id: a.p_session, stripe_invoice_id: a.p_invoice, stripe_payment_intent: a.p_intent, note: a.p_note, recorded_by: a.p_recorded_by });
    return { data: [{ booking: recalc(a.p_booking), inserted: !dup }], error: null };
  },
  refund_retreat_payment(a) {
    const hit = DB.tables.retreat_payments.filter((p) => p.stripe_payment_intent === a.p_intent && p.status === 'succeeded');
    hit.forEach((p) => { p.status = 'refunded'; });
    return { data: [...new Set(hit.map((p) => p.booking_id))].map(recalc), error: null };
  },
};

export function createClient() {
  return {
    from: (t) => new Q(t),
    rpc: async (name, args) => rpcs[name](args),
    auth: { admin: {
      createUser: async ({ email }) => DB.users.find((u) => u.email === email) ? { data: { user: null }, error: { message: 'already registered' } } : (DB.users.push({ id: 'U-' + email, email }), { data: { user: { id: 'U-' + email } }, error: null }),
      generateLink: async ({ email }) => { const u = DB.users.find((x) => x.email === email); return { data: { user: u, properties: { action_link: 'https://auth.example/verify?user=' + u.id } }, error: null }; },
    }, getUser: async () => ({ data: null, error: { message: 'x' } }) },
  };
}
