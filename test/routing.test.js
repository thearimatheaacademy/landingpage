import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const served = [];
const env = {
  SITE_URL: 'https://thearimatheaacademy.com',
  DASHBOARD_URL: 'https://dashboard.thearimatheaacademy.com/',
  LMS_URL: 'https://lms.thearimatheaacademy.com/',
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_pub', STRIPE_PUBLISHABLE_KEY: 'pk_test_1',
  ASSETS: { fetch: async (req) => { served.push(new URL(req.url).pathname); return new Response('<p>page</p>', { headers: { 'content-type': 'text/html' } }); } },
};
const get = (u) => worker.fetch(new Request(u, { redirect: 'manual' }), env, { waitUntil() {} });

test('old /landing pages redirect to their new homes, keeping the query string', async () => {
  for (const [from, to] of [
    ['/landing', '/bootcamp/'], ['/landing/', '/bootcamp/'], ['/landing/register/', '/register/'],
    ['/landing/register', '/register/'], ['/landing/cancelled/?id=1&t=2', '/cancelled/?id=1&t=2'], ['/landing/privacy/', '/privacy/'],
  ]) {
    const res = await get(`https://thearimatheaacademy.com${from}`);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), `https://thearimatheaacademy.com${to}`, from);
  }
});

test('www redirects to the bare domain; pages are served with security headers', async () => {
  const w = await get('https://www.thearimatheaacademy.com/retreat/?x=1');
  assert.equal(w.headers.get('location'), 'https://thearimatheaacademy.com/retreat/?x=1');
  const page = await get('https://thearimatheaacademy.com/retreat/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(served.at(-1), '/retreat/');
});

test('API answers on /api and on the old /landing/api paths (links in emails already sent)', async () => {
  for (const p of ['/api/config', '/landing/api/config']) {
    const res = await get(`https://thearimatheaacademy.com${p}`);
    assert.deepEqual(await res.json(), { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_pub', stripeKey: 'pk_test_1' });
  }
  const dash = await get('https://dashboard.thearimatheaacademy.com/landing/api/config');
  assert.equal((await dash.json()).supabaseKey, 'sb_pub');
});

test('dashboard and LMS keep working on their subdomains', async () => {
  await get('https://dashboard.thearimatheaacademy.com/');
  assert.equal(served.at(-1), '/landing/admin/');
  await get('https://lms.thearimatheaacademy.com/');
  assert.equal(served.at(-1), '/landing/lms/');
  const moved = await get('https://thearimatheaacademy.com/landing/admin/');
  assert.equal(moved.headers.get('location'), 'https://dashboard.thearimatheaacademy.com/');
  // assets the dashboard/LMS use are still served from /landing/
  await get('https://thearimatheaacademy.com/landing/img/gold-texture.jpg');
  assert.equal(served.at(-1), '/landing/img/gold-texture.jpg');
});

test('preview: dashboard and portal stay on the preview address; links point at it; no emails from cron', async () => {
  const p = { ...env, PREVIEW: 'true', SUPABASE_SERVICE_ROLE_KEY: 'test' };
  const host = 'https://landingpage-preview.example.workers.dev';
  const call = (u, init) => worker.fetch(new Request(host + u, { redirect: 'manual', ...init }), p, { waitUntil() {} });

  await call('/landing/admin/');
  assert.equal(served.at(-1), '/landing/admin/');
  await call('/landing/lms/');
  assert.equal(served.at(-1), '/landing/lms/');
  const home = await call('/');
  assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(served.at(-1), '/');
  assert.equal((await call('/landing/register/')).headers.get('location'), `${host}/register/`);

  // Email payment links from the preview open the preview, not the real site.
  assert.equal((await call('/api/pay?id=x')).headers.get('location'), `${host}/register/`);

  let touched = false;
  await worker.scheduled({}, { ...p, get SUPABASE_URL() { touched = true; return 'x'; } }, { waitUntil() { touched = true; } });
  assert.equal(touched, false);
});
