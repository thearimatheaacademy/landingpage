# Kingdom School: arimatheaacademy.com/kingdomschool

This project covers the landing page, registration with Stripe payment, the admin dashboard and the automated emails for the
Kingdom School of Business & Ministry Bootcamp.

| Piece | Where |
|---|---|
| Hosting, API, email scheduler (cron every 5 min) | Cloudflare Worker `kingdomschool` (`src/`) + static pages (`public/kingdomschool/`) |
| Database, admin login (email/password + Google OAuth), access control (RLS) | Supabase (`supabase/migrations/`) |
| Payments (£150, GBP) | Stripe Checkout + webhook |
| Email delivery | Resend |

## Pages
- `/kingdomschool/`: landing page (built from the design)
- `/kingdomschool/register/`: form that hands off to Stripe Checkout
- `/kingdomschool/success/`, `/kingdomschool/cancelled/`, `/privacy/`, `/terms/`
- `/kingdomschool/admin/`: dashboard (registrants, paid / not paid, CSV, notes, manual "mark paid",
  send payment link, compose & schedule emails, edit automations, Zoom link settings)

## How payment status works
1. The form posts to `POST /api/register`, which saves the person as **pending** and creates a Checkout Session.
2. Stripe calls `POST /api/stripe-webhook` (signature verified), which sets the status to **paid** and sends the
   confirmation email with the Zoom link immediately.
3. Refunds made in the Stripe dashboard flip the status to **refunded** (`charge.refunded`).

## Automated emails (editable in Admin → Automations)
- Paid, immediately: confirmation + Zoom link
- Paid, 10 Dec 2026: "starts tomorrow". Paid, 11 Dec 2026: "first session today"
- Not paid, +24h and +72h: "complete your registration" with a one-click payment link

Merge tags: `{{first_name}} {{last_name}} {{zoom_link}} {{zoom_passcode_line}} {{start_date}} {{session_time}} {{payment_link}}`.
The Zoom link is set in Admin → Settings.

## Setup (one time)

### 1. Supabase
1. Create a project in the *thearimatheaacademy* org (region `eu-west-2`, London).
2. Run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`).
3. In Auth → URL configuration, set the Site URL to `https://arimatheaacademy.com/kingdomschool/admin/`
   and add it to Redirect URLs. Optional: Auth → Providers → Google (needs a Google OAuth client).
4. Create the first admin:
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run create-admin -- admin@arimatheaacademy.com 'StrongPassword'`
   (Anyone who signs in with Google gets no access until promoted the same way.)

### 2. Stripe
- In Developers → Webhooks, add the endpoint `https://arimatheaacademy.com/kingdomschool/api/stripe-webhook`
  with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `charge.refunded`.
- Optional: set `STRIPE_PRICE_ID` to an existing £150 price. Otherwise the price is created inline.

### 3. Resend
Add the domain `arimatheaacademy.com`, add its DNS records (SPF/DKIM) in Cloudflare DNS and create an API key.

### 4. Domain: GoDaddy → Cloudflare
A Worker can only serve `arimatheaacademy.com/kingdomschool` if the domain's DNS is on Cloudflare:
1. In Cloudflare, add the site `arimatheaacademy.com` (Free plan). It imports the existing DNS records. Check that they
   match GoDaddy's so the rest of the site and email keep working.
2. In GoDaddy, go to Domain → Nameservers → "I'll use my own" and enter the two Cloudflare nameservers.
3. The main site stays wherever it's hosted today. Only `/kingdomschool*` is handled by this Worker.

### 5. Deploy
```
npm install
# edit wrangler.jsonc vars: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, EMAIL_FROM
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npm run deploy
```
Test end to end with Stripe test keys (card `4242 4242 4242 4242`) before switching to live keys.

## Development
Copy `.dev.vars.example` to `.dev.vars`, fill in test keys and run `npm run dev`. To receive webhooks locally, run
`stripe listen --forward-to localhost:8787/kingdomschool/api/stripe-webhook`. `npm test` runs the unit tests.
