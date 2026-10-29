// Test-only in-memory stand-in for @supabase/supabase-js (subset used by the Worker).
// Minimal in-memory stand-in for @supabase/supabase-js (enough for the Worker's queries).
export const DB = { tables: { registrants: [], email_log: [], email_sequence_steps: [], email_campaigns: [], settings: [], admins: [] }, users: [], failBatchWithDup: false };
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
      const made = rows.map((r) => ({ id: this.t === 'email_log' ? seq++ : crypto.randomUUID(), status: 'pending', pay_token: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      T.push(...made);
      return { data: this.one ? made[0] : made, error: null };
    }
    let rows = T.filter((r) => this.f.every((f) => f(r)));
    if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.patch)); }
    if (this.head) return { count: rows.length, data: null, error: null };
    if (this.rng) rows = rows.slice(this.rng[0], Math.min(this.rng[1] + 1, this.rng[0] + 1000));
    else if (this.op === 'select') rows = rows.slice(0, 1000); // PostgREST max_rows
    if (this.one) return { data: rows[0] ?? null, error: this.one === 'single' && !rows[0] ? { message: 'no row' } : null };
    return { data: rows, error: null };
  }
}
export function createClient() {
  return {
    from: (t) => new Q(t),
    auth: { admin: {
      createUser: async ({ email }) => DB.users.find((u) => u.email === email) ? { data: { user: null }, error: { message: 'already registered' } } : (DB.users.push({ id: 'U-' + email, email }), { data: { user: { id: 'U-' + email } }, error: null }),
      generateLink: async ({ email }) => { const u = DB.users.find((x) => x.email === email); return { data: { user: u, properties: { action_link: 'https://auth.example/verify?user=' + u.id } }, error: null }; },
    }, getUser: async () => ({ data: null, error: { message: 'x' } }) },
  };
}
