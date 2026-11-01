import { createClient } from '@supabase/supabase-js';
import { createCheckoutSession, verifyStripeSignature, stripeRequest } from './stripe.js';
import { runScheduler, sendToRegistrant, sendManual, sendLoginEmail } from './email.js';
import { book, getBooking, balanceCheckout, recordSession, recordInvoice, recordRefund, runRetreatReminders, adminRetreat } from './retreat.js';

// The site used to live under /landing. Admin and LMS pages (and their assets) still do, and links
// already emailed to registrants use /landing/api/..., so those keep working alongside /api/....
const LEGACY = '/landing';
const MOVED = {
  '/landing/': '/bootcamp/',
  '/landing/register/': '/register/',
  '/landing/success/': '/success/',
  '/landing/cancelled/': '/cancelled/',
  '/landing/privacy/': '/privacy/',
  '/landing/terms/': '/terms/',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const preview = isPreview(env);
    if (preview) env = previewEnv(env, url);
    // Subdomain apps share this Worker: each one's root serves its page under /landing/.
    // The preview has no subdomains: the dashboard and portal stay at /landing/admin/ and /landing/lms/.
    const apps = preview ? [] : [[env.DASHBOARD_URL, `${LEGACY}/admin/`], [env.LMS_URL, `${LEGACY}/lms/`]];
    const app = apps.find(([u]) => url.hostname === new URL(u).hostname);
    if (app) {
      // Browsers request these from the site root automatically.
      const rootIcons = { '/favicon.ico': 'favicon.ico', '/apple-touch-icon.png': 'apple-touch-icon.png' };
      if (rootIcons[url.pathname]) return env.ASSETS.fetch(new Request(new URL(`${LEGACY}/icons/${rootIcons[url.pathname]}`, url), request));
      if (url.pathname === '/') return withHeaders(await env.ASSETS.fetch(new Request(new URL(app[1], url), request)));
      if (!url.pathname.startsWith(`${LEGACY}/`)) return Response.redirect(`${url.origin}/`, 302);
    } else {
      // www → bare domain, keeping the path.
      if (url.hostname.startsWith('www.')) return Response.redirect(`${url.protocol}//${url.hostname.slice(4)}${url.pathname}${url.search}`, 301);
      // On the main domain, the app paths redirect to their subdomains.
      const moved = apps.find(([, path]) => url.pathname.startsWith(path.slice(0, -1)));
      if (moved) return Response.redirect(moved[0], 301);
    }

    const path = url.pathname;
    const api = path.startsWith('/api/') ? path.slice(4) : path.startsWith(`${LEGACY}/api/`) ? path.slice(`${LEGACY}/api`.length) : null;
    if (api === null) {
      if (!app) {
        const target = MOVED[path.endsWith('/') ? path : `${path}/`];
        if (target) return Response.redirect(`${url.origin}${target}${url.search}`, 301);
      }
      return withHeaders(await env.ASSETS.fetch(request), preview);
    }

    try {
      if (api === '/config' && request.method === 'GET') {
        // Public values only: pages need these to start Supabase Auth and Stripe's embedded checkout.
        return json({ supabaseUrl: env.SUPABASE_URL, supabaseKey: env.SUPABASE_PUBLISHABLE_KEY, stripeKey: env.STRIPE_PUBLISHABLE_KEY });
      }
      if (api === '/stripe-webhook' && request.method === 'POST') return await stripeWebhook(request, env, ctx);
      if (api === '/register' && request.method === 'POST') return await register(request, env, adminClient(env));
      if (api === '/checkout' && request.method === 'POST') return await resumeCheckout(request, env, adminClient(env));
      if (api === '/pay' && request.method === 'GET') return await resumePayment(url, env, adminClient(env));
      if (api === '/retreat/book' && request.method === 'POST') return await book(request, env, adminClient(env));
      if (api === '/retreat/booking' && request.method === 'GET') return await getBooking(url, adminClient(env));
      if (api === '/retreat/checkout' && request.method === 'POST') return await balanceCheckout(request, env, adminClient(env));
      if (api === '/retreat/return' && request.method === 'GET') return await retreatReturn(url, env, adminClient(env), ctx);
      if (api === '/lms/claim' && request.method === 'GET') return await claimAfterPayment(url, env, adminClient(env), ctx);
      if (api === '/lms/login' && request.method === 'POST') return await sendLoginLink(request, env, adminClient(env));
      // Admins see the real error (e.g. a Stripe refund failure); the public never does.
      if (api.startsWith('/admin/')) return await adminApi(api, request, env, adminClient(env), ctx).catch((e) => json({ error: e.message }, 500));
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    // The preview shares the real database: it must never send the automated emails (production does that).
    if (isPreview(env)) return;
    const db = adminClient(env);
    ctx.waitUntil(runScheduler(env, db).then((r) => console.log('scheduler', JSON.stringify(r))));
    ctx.waitUntil(runRetreatReminders(env, db).then((r) => console.log('retreat reminders', JSON.stringify(r))));
  },
};

// Security headers for pages served from /public (Stripe's checkout runs in its own iframe, so framing
// our pages is never needed).
function withHeaders(res, preview = false) {
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  out.headers.set('x-frame-options', 'SAMEORIGIN');
  if (preview) out.headers.set('x-robots-tag', 'noindex, nofollow'); // keep the test copy out of Google
  return out;
}

// ── Preview (`npm run preview:deploy`): the same site on its workers.dev address, for testing before the
// domain moves. Links in emails and Stripe return addresses point back at whatever address it is served on.
const isPreview = (env) => env.PREVIEW === 'true';
function previewEnv(env, url) {
  return { ...env, SITE_URL: url.origin, DASHBOARD_URL: `${url.origin}${LEGACY}/admin/`, LMS_URL: `${url.origin}${LEGACY}/lms/` };
}

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
    // Never let an unauthenticated request change an existing registration (anyone can type any email).
    // Refunded/cancelled rows stay as they are so they can't be quietly re-activated.
    if (existing.status !== 'pending') {
      return json({ error: 'This email already has a registration with us. Please contact info@thearimatheaacademy.com and we will help.' }, 409);
    }
    registrant = existing;
  } else {
    const { data, error } = await db.from('registrants').insert(r).select().single();
    if (error) throw error;
    registrant = data;
  }

  return json(await startCheckout(env, db, registrant));
}

// Step 2 of /register/: an Embedded Checkout session for this registrant.
async function startCheckout(env, db, registrant) {
  const session = await createCheckoutSession(env, registrant);
  await db.from('registrants').update({ stripe_session_id: session.id }).eq('id', registrant.id);
  return { client_secret: session.client_secret, registrant: { first_name: registrant.first_name, last_name: registrant.last_name, email: registrant.email } };
}

const uuid = /^[0-9a-f-]{36}$/i;

// Link in "complete your payment" emails: /api/pay?id=…&t=… (old emails use /landing/api/pay).
// Opens the register page at the payment step.
async function resumePayment(url, env, db) {
  const id = url.searchParams.get('id');
  const token = url.searchParams.get('t');
  if (!uuid.test(id || '') || !uuid.test(token || '')) return Response.redirect(`${env.SITE_URL}/register/`, 302);

  const { data: registrant } = await db.from('registrants').select('id, status').eq('id', id).eq('pay_token', token).maybeSingle();
  if (!registrant) return Response.redirect(`${env.SITE_URL}/register/`, 302);
  if (registrant.status === 'paid') return Response.redirect(`${env.SITE_URL}/success/?already=1`, 302);
  return Response.redirect(`${env.SITE_URL}/register/?id=${id}&t=${token}`, 302);
}

// POST /api/checkout {id, t}: the register page asking for a payment step for an existing registration.
async function resumeCheckout(request, env, db) {
  const { id, t } = await request.json().catch(() => ({}));
  if (!uuid.test(id || '') || !uuid.test(t || '')) return json({ error: 'That payment link is not valid. Please register again.' }, 400);
  const { data: registrant } = await db.from('registrants').select('*').eq('id', id).eq('pay_token', t).maybeSingle();
  if (!registrant) return json({ error: 'That payment link is not valid. Please register again.' }, 404);
  if (registrant.status === 'paid') return json({ error: 'You are already registered and paid. Check your inbox for your confirmation and Zoom link.', paid: true }, 409);
  if (registrant.status !== 'pending') return json({ error: 'This registration can no longer be paid online. Please contact info@thearimatheaacademy.com and we will help.' }, 409);
  return json(await startCheckout(env, db, registrant));
}

// Embedded Checkout for the retreat returns here: record the payment (the webhook may be slower), then thank them.
async function retreatReturn(url, env, db, ctx) {
  const sessionId = url.searchParams.get('session_id') || '';
  if (!/^cs_(test|live)_\w+$/.test(sessionId)) return Response.redirect(`${env.SITE_URL}/retreat/`, 302);
  const session = await stripeRequest(env, 'GET', `/v1/checkout/sessions/${sessionId}`);
  if (session.metadata?.kind !== 'retreat') return Response.redirect(`${env.SITE_URL}/retreat/`, 302);
  if (session.payment_status !== 'paid') return Response.redirect(`${env.SITE_URL}/retreat/booked/?processing=1`, 302);
  const booking = await recordSession(env, db, session, ctx);
  const q = new URLSearchParams({ ref: booking?.reference || '', status: booking?.status || 'paid' });
  if (booking && booking.status === 'deposit_paid') q.set('balance', String(booking.total_amount - booking.amount_paid));
  return Response.redirect(`${env.SITE_URL}/retreat/booked/?${q}`, 302);
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
    if (obj.metadata?.kind === 'retreat') {
      await recordSession(env, db, obj, ctx);
    } else {
      const registrant = await markPaidFromSession(db, obj);
      // Send the confirmation (+ Zoom link) straight away rather than waiting for the cron.
      if (registrant) ctx.waitUntil(sendToRegistrant(env, db, registrant).catch((e) => console.error('confirm email', e)));
    }
  } else if (event.type === 'invoice.paid') {
    await recordInvoice(env, db, obj, ctx);
  } else if (event.type === 'invoice.voided' || event.type === 'invoice.marked_uncollectible') {
    await db.from('retreat_bookings').update({ invoice_status: obj.status }).eq('stripe_invoice_id', obj.id);
  } else if (event.type === 'charge.refunded' && obj.refunded) {
    await db.from('registrants').update({ status: 'refunded' }).eq('stripe_payment_intent', obj.payment_intent);
    await recordRefund(db, obj.payment_intent);
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

  // Paying proves payment, not ownership of the email typed into the form. Only sign the browser in
  // directly when this checkout just created the account; an existing account (e.g. an admin's) gets
  // its sign-in link by email, so only the real mailbox owner can use it.
  const { link, created } = await magicLink(env, db, registrant, env.LMS_URL);
  if (created) return Response.redirect(link, 302);
  if (!(await recentlySentLogin(db, registrant.id))) await sendLoginEmail(env, db, registrant, link);
  return Response.redirect(`${env.LMS_URL}?check-email=1`, 302);
}

async function recentlySentLogin(db, registrantId) {
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const { count } = await db.from('email_log').select('id', { count: 'exact', head: true }).eq('registrant_id', registrantId).eq('kind', 'login').gte('created_at', since);
  return count > 0;
}

// Email a one-click sign-in link to a paid registrant. Always answers the same way so emails can't be probed.
async function sendLoginLink(request, env, db) {
  const { email } = await request.json().catch(() => ({}));
  const addr = clean(email, 254).toLowerCase();
  const { data: registrant } = await db.from('registrants').select('*').eq('email', addr).eq('status', 'paid').maybeSingle();
  if (registrant && !(await recentlySentLogin(db, registrant.id))) {
    await sendLoginEmail(env, db, registrant, (await magicLink(env, db, registrant, env.LMS_URL)).link);
  }
  return json({ ok: true });
}

// Returns a sign-in link for the registrant's email, and whether this call created the account.
async function magicLink(env, db, registrant, redirectTo) {
  const { data: made, error: createErr } = await db.auth.admin.createUser({ email: registrant.email, email_confirm: true, user_metadata: { name: `${registrant.first_name} ${registrant.last_name}` } });
  const created = !createErr && !!made?.user;
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: registrant.email, options: { redirectTo } });
  if (error) throw error;
  if (data.user && registrant.user_id !== data.user.id) await db.from('registrants').update({ user_id: data.user.id }).eq('id', registrant.id);
  return { link: data.properties.action_link, created };
}

// Marks the session's registrant as paid. Returns the registrant only if this call changed them.
async function markPaidFromSession(db, session) {
  if (session.payment_status !== 'paid' || session.metadata?.kind === 'retreat') return null;
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
async function adminApi(api, request, env, db, ctx) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  const { data: userData, error: authErr } = await db.auth.getUser(token);
  if (authErr || !userData?.user) return json({ error: 'Unauthorised' }, 401);
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', userData.user.id).maybeSingle();
  if (!admin) return json({ error: 'Forbidden' }, 403);

  if (api.startsWith('/admin/retreat/') && request.method === 'POST') {
    return adminRetreat(api, request, env, db, userData.user.email, ctx);
  }
  if (isPreview(env) && ['/admin/run-scheduler', '/admin/sync'].includes(api)) {
    return json({ error: 'Turned off in the preview: this would email real registrants. Use the live dashboard.' }, 403);
  }
  if (api === '/admin/run-scheduler' && request.method === 'POST') {
    const [bootcamp, retreat] = await Promise.all([runScheduler(env, db), runRetreatReminders(env, db)]);
    return json({ ...bootcamp, retreat });
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
    await recordRefund(db, payment_intent);
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
