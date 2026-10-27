import { createClient } from '@supabase/supabase-js';
import { createCheckoutSession, verifyStripeSignature } from './stripe.js';
import { runScheduler, sendToRegistrant, sendManual } from './email.js';

const BASE = '/kingdomschool';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/`, 301);

    const api = url.pathname.startsWith(`${BASE}/api/`) ? url.pathname.slice(`${BASE}/api`.length) : null;
    if (api === null) return env.ASSETS.fetch(request);

    try {
      if (api === '/config' && request.method === 'GET') {
        // Public values only: the admin page needs these to start Supabase Auth.
        return json({ supabaseUrl: env.SUPABASE_URL, supabaseKey: env.SUPABASE_PUBLISHABLE_KEY });
      }
      if (api === '/stripe-webhook' && request.method === 'POST') return await stripeWebhook(request, env, ctx);
      if (api === '/register' && request.method === 'POST') return await register(request, env, adminClient(env));
      if (api === '/pay' && request.method === 'GET') return await resumePayment(url, env, adminClient(env));
      if (api.startsWith('/admin/')) return await adminApi(api, request, env, adminClient(env));
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduler(env, adminClient(env)).then((r) => console.log('scheduler', JSON.stringify(r))));
  },
};

function adminClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ── Public: registration ─────────────────────────────────────
async function register(request, env, db) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ error: 'Invalid submission' }, 400); // honeypot

  const r = {
    first_name: clean(body.first_name, 100),
    last_name: clean(body.last_name, 100),
    email: clean(body.email, 254).toLowerCase(),
    phone: clean(body.phone, 40) || null,
    country: clean(body.country, 80) || null,
    organisation: clean(body.organisation, 200) || null,
    how_heard: clean(body.how_heard, 200) || null,
    goals: clean(body.goals, 2000) || null,
    marketing_consent: body.marketing_consent === true,
  };
  if (!r.first_name || !r.last_name) return json({ error: 'Please enter your first and last name.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (body.accept_terms !== true) return json({ error: 'Please accept the terms to continue.' }, 400);

  const { data: existing, error: findErr } = await db.from('registrants').select('*').eq('email', r.email).maybeSingle();
  if (findErr) throw findErr;

  let registrant;
  if (existing?.status === 'paid') {
    return json({ error: 'This email is already registered and paid. Check your inbox for your confirmation and Zoom link.' }, 409);
  } else if (existing) {
    const { data, error } = await db.from('registrants').update({ ...r, status: 'pending' }).eq('id', existing.id).select().single();
    if (error) throw error;
    registrant = data;
  } else {
    const { data, error } = await db.from('registrants').insert(r).select().single();
    if (error) throw error;
    registrant = data;
  }

  const session = await createCheckoutSession(env, registrant);
  await db.from('registrants').update({ stripe_session_id: session.id }).eq('id', registrant.id);
  return json({ url: session.url });
}

// Link in "complete your payment" emails: /kingdomschool/api/pay?id=…&t=…
async function resumePayment(url, env, db) {
  const id = url.searchParams.get('id');
  const token = url.searchParams.get('t');
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id || '') || !uuid.test(token || '')) return Response.redirect(`${env.SITE_URL}/register/`, 302);

  const { data: registrant } = await db.from('registrants').select('*').eq('id', id).eq('pay_token', token).maybeSingle();
  if (!registrant) return Response.redirect(`${env.SITE_URL}/register/`, 302);
  if (registrant.status === 'paid') return Response.redirect(`${env.SITE_URL}/success/?already=1`, 302);

  const session = await createCheckoutSession(env, registrant);
  await db.from('registrants').update({ stripe_session_id: session.id }).eq('id', registrant.id);
  return Response.redirect(session.url, 303);
}

// ── Stripe webhook: the source of truth for payment status ───
async function stripeWebhook(request, env, ctx) {
  const payload = await request.text();
  const ok = await verifyStripeSignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'Invalid signature' }, 400);
  const db = adminClient(env);

  const event = JSON.parse(payload);
  const obj = event.data.object;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (obj.payment_status !== 'paid') return json({ received: true });
    const id = obj.metadata?.registrant_id || obj.client_reference_id;
    const { data: registrant, error } = await db
      .from('registrants')
      .update({
        status: 'paid',
        paid_at: new Date((obj.created || Date.now() / 1000) * 1000).toISOString(),
        stripe_session_id: obj.id,
        stripe_payment_intent: obj.payment_intent,
        amount_paid: obj.amount_total,
        currency: obj.currency,
      })
      .eq('id', id)
      .neq('status', 'paid')
      .select()
      .maybeSingle();
    if (error) throw error;
    // Send the confirmation (+ Zoom link) straight away rather than waiting for the cron.
    if (registrant) ctx.waitUntil(sendToRegistrant(env, db, registrant).catch((e) => console.error('confirm email', e)));
  } else if (event.type === 'charge.refunded' && obj.refunded) {
    await db.from('registrants').update({ status: 'refunded' }).eq('stripe_payment_intent', obj.payment_intent);
  }
  return json({ received: true });
}

// ── Admin API (Supabase JWT + public.admins membership) ──────
async function adminApi(api, request, env, db) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  const { data: userData, error: authErr } = await db.auth.getUser(token);
  if (authErr || !userData?.user) return json({ error: 'Unauthorised' }, 401);
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', userData.user.id).maybeSingle();
  if (!admin) return json({ error: 'Forbidden' }, 403);

  if (api === '/admin/run-scheduler' && request.method === 'POST') {
    return json(await runScheduler(env, db));
  }
  if (api === '/admin/send' && request.method === 'POST') {
    // Send an email now to specific registrants (e.g. "resend payment link").
    const { registrant_ids, subject, html } = await request.json();
    if (!Array.isArray(registrant_ids) || !registrant_ids.length || !subject || !html) return json({ error: 'Missing fields' }, 400);
    return json(await sendManual(env, db, registrant_ids.slice(0, 100), subject, html));
  }
  return json({ error: 'Not found' }, 404);
}
