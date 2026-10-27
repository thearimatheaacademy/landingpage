import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyStripeSignature } from '../src/stripe.js';
import { dueStep } from '../src/email.js';

const sign = (payload, secret, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

test('accepts a valid Stripe signature', async () => {
  assert.equal(await verifyStripeSignature('{"a":1}', sign('{"a":1}', 'whsec_x'), 'whsec_x'), true);
});
test('rejects tampered payload, wrong secret and stale timestamp', async () => {
  assert.equal(await verifyStripeSignature('{"a":2}', sign('{"a":1}', 'whsec_x'), 'whsec_x'), false);
  assert.equal(await verifyStripeSignature('{"a":1}', sign('{"a":1}', 'other'), 'whsec_x'), false);
  assert.equal(await verifyStripeSignature('{"a":1}', sign('{"a":1}', 'whsec_x', 1000), 'whsec_x'), false);
  assert.equal(await verifyStripeSignature('{"a":1}', null, 'whsec_x'), false);
});

const H = 3600e3, now = Date.parse('2026-12-01T12:00:00Z');
test('delay steps fire after the delay and within the 48h window', () => {
  const step = { audience: 'pending', delay_hours: 24 };
  assert.equal(dueStep(step, { created_at: new Date(now - 23 * H).toISOString() }, now), false);
  assert.equal(dueStep(step, { created_at: new Date(now - 25 * H).toISOString() }, now), true);
  assert.equal(dueStep(step, { created_at: new Date(now - 80 * H).toISOString() }, now), false);
  assert.equal(dueStep({ audience: 'paid', delay_hours: 0 }, { paid_at: new Date(now).toISOString() }, now), true);
  assert.equal(dueStep({ audience: 'paid', delay_hours: 0 }, { paid_at: null }, now), false);
});
test('fixed-time steps fire only within 24h of send_at', () => {
  const step = { audience: 'paid', send_at: '2026-12-01T10:00:00Z' };
  assert.equal(dueStep(step, {}, now), true);
  assert.equal(dueStep(step, {}, Date.parse('2026-12-01T09:00:00Z')), false);
  assert.equal(dueStep(step, {}, Date.parse('2026-12-02T11:00:00Z')), false);
});

test('registrants with skip_auto_emails only get fixed-time steps', () => {
  const r = { skip_auto_emails: true, paid_at: new Date(now).toISOString() };
  assert.equal(dueStep({ audience: 'paid', delay_hours: 0 }, r, now), false);
  assert.equal(dueStep({ audience: 'paid', send_at: '2026-12-01T10:00:00Z' }, r, now), true);
});
