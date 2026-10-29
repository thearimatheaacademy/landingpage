import test from 'node:test';
import assert from 'node:assert/strict';
import { DB, createClient } from './helpers/fake-supabase.mjs';
import { runScheduler } from '../src/email.js';

const env = { SITE_URL: 'https://site.example/landing', LMS_URL: 'https://lms.example/', RESEND_API_KEY: 'x', EMAIL_FROM: 'a@b' };
const sent = [];
globalThis.fetch = async (_url, init) => {
  const batch = JSON.parse(init.body);
  sent.push(...batch.map((m) => m.to[0]));
  return new Response(JSON.stringify({ data: batch.map((_, i) => ({ id: 'e' + i })) }));
};

test('scheduler reads past the 1000-row cap and never re-sends logged emails', async () => {
  const now = new Date().toISOString();
  DB.tables.email_sequence_steps = [{ id: 'S1', audience: 'paid', delay_hours: 0, subject: 'Hi', html: '<p>{{first_name}}</p>', active: true, sort_order: 1 }];
  for (let i = 0; i < 1200; i++) {
    DB.tables.registrants.push({ id: 'P' + i, email: `p${i}@example.test`, first_name: 'P', last_name: String(i), status: 'paid', paid_at: now, pay_token: 't' });
    DB.tables.email_log.push({ id: i + 1, registrant_id: 'P' + i, kind: 'sequence', ref_id: 'S1', status: 'sent' });
  }
  const db = createClient();
  assert.equal((await runScheduler(env, db)).queued, 0);

  // One unlogged + one new recipient: both sent once, both logged despite a duplicate in the batch path.
  DB.tables.email_log.pop();
  DB.tables.registrants.push({ id: 'NEW', email: 'fresh@example.test', first_name: 'F', last_name: 'R', status: 'paid', paid_at: now, pay_token: 't' });
  assert.equal((await runScheduler(env, db)).sent, 2);
  assert.equal((await runScheduler(env, db)).queued, 0);
  assert.deepEqual(sent.sort(), ['fresh@example.test', 'p1199@example.test']);
});
