import { createClient } from '@supabase/supabase-js';
import { createCheckoutSession, verifyStripeSignature, stripeRequest } from './stripe.js';
import { runScheduler, sendToRegistrant, sendManual, sendLoginEmail } from './email.js';

const BASE = '/landing';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Subdomain apps share this Worker: each one's root serves its page under /landing/.
    const apps = [[env.DASHBOARD_URL, `${BASE}/admin/`], [env.LMS_URL, `${BASE}/lms/`]];
    const app = apps.find(([u]) => url.hostname === new URL(u).hostname);
    if (app) {
      if (url.pathname === '/') return env.ASSETS.fetch(new Request(new URL(app[1], url), request));
      if (!url.pathname.startsWith(`${BASE}/`)) return Response.redirect(`${url.origin}/`, 302);
    } else {
      // On the main domain, the app paths redirect to their subdomains.
      const moved = apps.find(([, path]) => url.pathname.startsWith(path.slice(0, -1)));
      if (moved) return Response.redirect(moved[0], 301);
    }

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
      if (api === '/lms/claim' && request.method === 'GET') return await claimAfterPayment(url, env, adminClient(env), ctx);
      if (api === '/lms/login' && request.method === 'POST') return await sendLoginLink(request, env, adminClient(env));
      // Admins see the real error (e.g. a Stripe refund failure); the public never does.
      if (api.startsWith('/admin/')) return await adminApi(api, request, env, adminClient(env)).catch((e) => json({ error: e.message }, 500));
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
  if (!r.phone || r.phone.replace(/\D/g, '').length < 7) return json({ error: 'Please enter your phone / WhatsApp number.' }, 400);
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

// Link in "complete your payment" emails: /landing/api/pay?id=…&t=…
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
    const registrant = await markPaidFromSession(db, obj);
    // Send the confirmation (+ Zoom link) straight away rather than waiting for the cron.
    if (registrant) ctx.waitUntil(sendToRegistrant(env, db, registrant).catch((e) => console.error('confirm email', e)));
  } else if (event.type === 'charge.refunded' && obj.refunded) {
    await db.from('registrants').update({ status: 'refunded' }).eq('stripe_payment_intent', obj.payment_intent);
  }
  return json({ received: true });
}

// ── Student portal (LMS) sign-in ─────────────────────────────
// Stripe's success_url lands here: confirm the payment, then sign the student straight into the portal.
async function claimAfterPayment(url, env, db, ctx) {
  const sessionId = url.searchParams.get('session_id') || '';
  if (!/^cs_(test|live)_\w+$/.test(sessionId)) return Response.redirect(env.LMS_URL, 302);

  const session = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
  if (session.payment_status !== 'paid') return Response.redirect(`${env.SITE_URL}/success/?processing=1`, 302);

  // The webhook may not have arrived yet; marking paid here is idempotent.
  const changed = await markPaidFromSession(db, session);
  if (changed) ctx.waitUntil(sendToRegistrant(env, db, changed).catch((e) => console.error('confirm email', e)));

  // Auto sign-in only right after checkout; an old link falls back to the normal sign-in page.
  if (Date.now() / 1000 - session.created > 48 * 3600) return Response.redirect(env.LMS_URL, 302);
  const { data: registrant } = await db.from('registrants').select('*').eq('id', session.metadata?.registrant_id || session.client_reference_id).maybeSingle();
  if (registrant?.status !== 'paid') return Response.redirect(env.LMS_URL, 302);
  return Response.redirect(await magicLink(env, db, registrant, env.LMS_URL), 302);
}

// Email a one-click sign-in link to a paid registrant. Always answers the same way so emails can't be probed.
async function sendLoginLink(request, env, db) {
  const { email } = await request.json().catch(() => ({}));
  const addr = clean(email, 254).toLowerCase();
  const { data: registrant } = await db.from('registrants').select('*').eq('email', addr).eq('status', 'paid').maybeSingle();
  if (registrant) {
    const since = new Date(Date.now() - 60 * 1000).toISOString();
    const { count } = await db.from('email_log').select('id', { count: 'exact', head: true }).eq('registrant_id', registrant.id).eq('kind', 'login').gte('created_at', since);
    if (!count) await sendLoginEmail(env, db, registrant, await magicLink(env, db, registrant, env.LMS_URL));
  }
  return json({ ok: true });
}

async function magicLink(env, db, registrant, redirectTo) {
  // Create the student's account on first use (ignored if it already exists).
  await db.auth.admin.createUser({ email: registrant.email, email_confirm: true, user_metadata: { name: `${registrant.first_name} ${registrant.last_name}` } });
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: registrant.email, options: { redirectTo } });
  if (error) throw error;
  if (data.user && registrant.user_id !== data.user.id) await db.from('registrants').update({ user_id: data.user.id }).eq('id', registrant.id);
  return data.properties.action_link;
}

// Marks the session's registrant as paid. Returns the registrant only if this call changed them.
async function markPaidFromSession(db, session) {
  if (session.payment_status !== 'paid') return null;
  const id = session.metadata?.registrant_id || session.client_reference_id;
  if (!id) return null;
  const { data, error } = await db
    .from('registrants')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent,
      amount_paid: session.amount_total,
      currency: session.currency,
    })
    .eq('id', id)
    .in('status', ['pending', 'cancelled'])
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
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
  if (api === '/admin/payments' && request.method === 'POST') {
    const { starting_after } = await request.json().catch(() => ({}));
    return json(await listPayments(env, db, starting_after));
  }
  if (api === '/admin/refund' && request.method === 'POST') {
    const { payment_intent, reason } = await request.json();
    if (!/^pi_\w+$/.test(payment_intent || '')) return json({ error: 'Invalid payment' }, 400);
    await stripeRequest(env, 'POST', '/v1/refunds', {
      payment_intent,
      reason: 'requested_by_customer',
      'metadata[refunded_by]': userData.user.email,
      ...(reason ? { 'metadata[note]': String(reason).slice(0, 200) } : {}),
    });
    // The charge.refunded webhook also does this; updating now keeps the dashboard instant.
    await db.from('registrants').update({ status: 'refunded' }).eq('stripe_payment_intent', payment_intent);
    return json({ ok: true });
  }
  if (api === '/admin/sync' && request.method === 'POST') {
    // Safety net for missed webhooks: re-check every unpaid registrant's latest Checkout Session.
    const { data: pending } = await db.from('registrants').select('id, stripe_session_id').eq('status', 'pending').not('stripe_session_id', 'is', null).limit(100);
    let updated = 0;
    for (const r of pending || []) {
      const session = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${r.stripe_session_id}`);
      const registrant = await markPaidFromSession(db, session);
      if (registrant) { updated++; await sendToRegistrant(env, db, registrant); }
    }
    return json({ checked: pending?.length || 0, updated });
  }
  return json({ error: 'Not found' }, 404);
}

// Recent successful-or-refunded charges from Stripe, matched to registrants by payment intent.
async function listPayments(env, db, startingAfter) {
  const params = { limit: '50', ...(startingAfter ? { starting_after: startingAfter } : {}) };
  const charges = await stripeRequest(env, 'GET', '/v1/charges', params);
  const intents = charges.data.map((c) => c.payment_intent).filter(Boolean);
  const { data: regs } = intents.length
    ? await db.from('registrants').select('id, first_name, last_name, email, stripe_payment_intent').in('stripe_payment_intent', intents)
    : { data: [] };
  const byIntent = Object.fromEntries((regs || []).map((r) => [r.stripe_payment_intent, r]));
  return {
    has_more: charges.has_more,
    payments: charges.data.map((c) => ({
      id: c.id,
      payment_intent: c.payment_intent,
      amount: c.amount,
      amount_refunded: c.amount_refunded,
      currency: c.currency,
      status: c.refunded ? 'refunded' : c.amount_refunded ? 'partially_refunded' : c.status,
      created: c.created,
      email: c.billing_details?.email || c.receipt_email,
      name: c.billing_details?.name,
      card: c.payment_method_details?.card ? `${c.payment_method_details.card.brand} •••• ${c.payment_method_details.card.last4}` : c.payment_method_details?.type,
      receipt_url: c.receipt_url,
      registrant: byIntent[c.payment_intent] || null,
    })),
  };
}
