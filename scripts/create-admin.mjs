// Creates (or promotes) a dashboard admin.
// Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run create-admin -- admin@example.com 'StrongPassword'
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!email || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run create-admin -- <email> [password]');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let userId;
const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (created?.user) {
  userId = created.user.id;
} else {
  // Already exists (e.g. signed in with Google first): look them up and promote.
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (!userId) throw error;
}
const { error: adminErr } = await db.from('admins').upsert({ user_id: userId });
if (adminErr) throw adminErr;
console.log(`Admin ready: ${email} (${userId})`);
