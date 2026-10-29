// Email automation: sequence steps, scheduled campaigns and manual sends, delivered via Resend.

const MAX_PER_RUN = 100; // Resend batch limit; the cron runs every 5 minutes.
const DELAY_STEP_WINDOW_H = 48; // don't send a delay-based step more than 48h late
const FIXED_STEP_WINDOW_H = 24; // don't send a fixed-time step more than 24h late
const HOUR = 3600 * 1000;

export async function runScheduler(env, db) {
  const now = Date.now();
  const [settings, steps, registrants, sent, campaigns] = await Promise.all([
    loadSettings(db),
    db.from('email_sequence_steps').select('*').eq('active', true).order('sort_order').then(unwrap),
    // Paged: a single select is capped by the database's max rows, which would silently drop records.
    fetchAll(() => db.from('registrants').select('*').in('status', ['paid', 'pending']).order('id')),
    fetchAll(() => db.from('email_log').select('registrant_id, kind, ref_id').eq('status', 'sent').in('kind', ['sequence', 'campaign']).order('id')),
    db.from('email_campaigns').select('*').in('status', ['scheduled', 'sending']).lte('scheduled_for', new Date(now).toISOString()).then(unwrap),
  ]);
  const done = new Set(sent.map((s) => `${s.registrant_id}:${s.kind}:${s.ref_id}`));
  const queue = [];

  for (const step of steps) {
    for (const r of registrants) {
      if (r.status !== step.audience || done.has(`${r.id}:sequence:${step.id}`)) continue;
      if (dueStep(step, r, now)) queue.push({ registrant: r, kind: 'sequence', ref_id: step.id, subject: step.subject, html: step.html });
    }
  }

  const remaining = new Map();
  for (const c of campaigns) {
    const audience = registrants.filter((r) => c.audience === 'all' || r.status === c.audience);
    const pending = audience.filter((r) => !done.has(`${r.id}:campaign:${c.id}`));
    pending.forEach((r) => queue.push({ registrant: r, kind: 'campaign', ref_id: c.id, subject: c.subject, html: c.html }));
    remaining.set(c.id, pending.length);
  }

  const results = await deliver(env, db, settings, queue.slice(0, MAX_PER_RUN));

  // Large campaigns span several runs; failed sends are retried on the next run.
  for (const c of campaigns) {
    const count = results.filter((r) => r.ref_id === c.id && r.status === 'sent').length;
    const status = remaining.get(c.id) - count <= 0 ? 'sent' : 'sending';
    await db.from('email_campaigns').update({ status, sent_count: (c.sent_count || 0) + count }).eq('id', c.id);
  }
  return { queued: queue.length, sent: results.filter((r) => r.status === 'sent').length, failed: results.filter((r) => r.status === 'failed').length };
}

export function dueStep(step, r, now) {
  if (step.send_at) {
    const at = Date.parse(step.send_at);
    return now >= at && now < at + FIXED_STEP_WINDOW_H * HOUR;
  }
  if (r.skip_auto_emails) return false; // e.g. imported registrants: only fixed-date steps reach them
  const anchor = Date.parse(step.audience === 'paid' ? r.paid_at : r.created_at);
  if (!anchor) return false;
  const at = anchor + Number(step.delay_hours) * HOUR;
  return now >= at && now < at + DELAY_STEP_WINDOW_H * HOUR;
}

// Called by the Stripe webhook right after payment: sends any paid-audience steps due now (the confirmation).
export async function sendToRegistrant(env, db, registrant) {
  const [settings, steps, sent] = await Promise.all([
    loadSettings(db),
    db.from('email_sequence_steps').select('*').eq('active', true).eq('audience', registrant.status).order('sort_order').then(unwrap),
    db.from('email_log').select('ref_id').eq('registrant_id', registrant.id).eq('kind', 'sequence').eq('status', 'sent').then(unwrap),
  ]);
  const done = new Set(sent.map((s) => s.ref_id));
  const now = Date.now();
  const queue = steps
    .filter((s) => s.delay_hours !== null && !done.has(s.id) && dueStep(s, registrant, now))
    .map((s) => ({ registrant, kind: 'sequence', ref_id: s.id, subject: s.subject, html: s.html }));
  return deliver(env, db, settings, queue);
}

export async function sendManual(env, db, ids, subject, html) {
  const [settings, registrants] = await Promise.all([loadSettings(db), db.from('registrants').select('*').in('id', ids).then(unwrap)]);
  const results = await deliver(env, db, settings, registrants.map((registrant) => ({ registrant, kind: 'manual', ref_id: null, subject, html })));
  return { sent: results.filter((r) => r.status === 'sent').length, failed: results.filter((r) => r.status === 'failed').length };
}

export async function sendLoginEmail(env, db, registrant, link) {
  const html = `<p>Dear {{first_name}},</p><p>Here is your sign-in link for the Kingdom School student portal:</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#23571F;color:#FBF5E3;padding:14px 26px;text-decoration:none;font-weight:600">SIGN IN TO THE PORTAL</a></p>
<p>The link works once and expires in 1 hour. If you didn't ask for it, you can ignore this email.</p><p>The Arimathea Academy</p>`;
  return deliver(env, db, await loadSettings(db), [{ registrant, kind: 'login', ref_id: null, subject: 'Your Kingdom School sign-in link', html }]);
}

async function deliver(env, db, settings, queue) {
  if (!queue.length) return [];
  const emails = queue.map(({ registrant, subject, html }) => {
    const vars = mergeVars(env, settings, registrant);
    return {
      from: env.EMAIL_FROM,
      to: [registrant.email],
      ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      subject: merge(subject, vars, false),
      html: layout(merge(html, vars, true)),
    };
  });

  let ids = [];
  let error = null;
  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(emails),
    });
    const body = await res.json();
    if (!res.ok) error = body.message || `Resend HTTP ${res.status}`;
    else ids = (body.data || []).map((d) => d.id);
  } catch (e) {
    error = String(e);
  }

  const rows = queue.map((q, i) => ({
    registrant_id: q.registrant.id,
    to_email: q.registrant.email,
    kind: q.kind,
    ref_id: q.ref_id,
    subject: emails[i].subject,
    status: error ? 'failed' : 'sent',
    error,
    provider_id: ids[i] || null,
  }));
  // One duplicate row makes a batch insert fail entirely, which would leave every send in it unlogged
  // (and re-sent next run). Fall back to row-by-row so everything that can be recorded is.
  const { error: logErr } = await db.from('email_log').insert(rows);
  if (logErr) {
    console.error('email_log batch insert', logErr);
    for (const row of rows) {
      const { error } = await db.from('email_log').insert(row);
      if (error && error.code !== '23505') console.error('email_log insert', error);
    }
  }
  return rows;
}

async function loadSettings(db) {
  const rows = await db.from('settings').select('key, value').then(unwrap);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function mergeVars(env, settings, r) {
  return {
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    zoom_link: settings.zoom_link || '',
    zoom_passcode_line: settings.zoom_passcode ? `Passcode: ${settings.zoom_passcode}` : '',
    start_date: settings.start_date || '',
    session_time: settings.session_time || '',
    payment_link: `${env.SITE_URL}/api/pay?id=${r.id}&t=${r.pay_token}`,
    lms_link: env.LMS_URL,
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function merge(template, vars, html) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (Object.hasOwn(vars, k) ? (html ? escapeHtml(vars[k]) : vars[k]) : m));
}

function layout(inner) {
  return `<!doctype html><html><body style="margin:0;background:#FBF5E3">
<div style="max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:#2B2A24;font-size:16px;line-height:1.6">
<div style="background:#1E3A1B;padding:18px 24px;color:#E9D08A;letter-spacing:.3em;font-size:13px;font-weight:600">THE ARIMATHEA ACADEMY</div>
<div style="background:#ffffff;padding:28px 24px">${inner}</div>
<div style="padding:18px 24px;font-size:12px;color:#6b6858">Kingdom School of Business &amp; Ministry Bootcamp · thearimatheaacademy.com/landing</div>
</div></body></html>`;
}

const PAGE = 1000;
async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query().range(from, from + PAGE - 1).then(unwrap);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
