# The Arimathea Academy: website, registrations and payments

Everything for **thearimatheaacademy.com** runs on one Cloudflare Worker:

| Piece | Where |
|---|---|
| Website pages (home, bootcamp, retreat, programmes, policies) | `public/` (static files served by the Worker) |
| Bootcamp registration (2 steps: details, then Stripe embedded payment) | `/register/` |
| Retreat booking (2 steps; several attendees; pay in full or £50/person deposit) | `/retreat/book/` |
| API, Stripe webhook, email scheduler (cron every 5 min) | `src/` |
| Admin dashboard | `dashboard.thearimatheaacademy.com` (`public/landing/admin/`) |
| Student portal (bootcamp) | `lms.thearimatheaacademy.com` (`public/landing/lms/`) |
| Database, admin login, access rules | Supabase project `kingdom-school` (`supabase/migrations/`) |
| Payments and invoices | Stripe (Embedded Checkout, Invoices, webhook) |
| Email delivery | Resend |

Read `CLAUDE.md` before editing. `docs/` holds decisions, content facts and the to-do list.

## Pages
- `/`, `/bootcamp/`, `/retreat/`, `/programmes/`
- `/register/`: bootcamp registration. `/register/?id=…&t=…` (from reminder emails) opens straight at payment.
- `/retreat/book/`: retreat booking. `?room=single`, `?room=double` or `?option=deposit` preselect a choice.
  `/retreat/book/?id=…&t=…` (from balance emails) opens at payment for whatever is still owed.
- `/success/`, `/cancelled/`, `/retreat/booked/`, `/privacy/`, `/terms/`, `404.html`
- Old addresses keep working: `/landing/` → `/bootcamp/`, `/landing/register/` → `/register/` (and the other
  `/landing/...` pages), and `/landing/api/...` still answers, because emails already sent to registrants use it.

## How payments work

### Bootcamp (£150)
1. Step 1 posts to `POST /api/register`, which saves the person as **pending** and creates an Embedded Checkout
   session. Step 2 shows Stripe's payment form on the page.
2. After paying, Stripe sends the browser to `/api/lms/claim`, which confirms the payment and signs them into the portal.
3. The webhook (`checkout.session.completed`) marks them **paid** and sends the confirmation with the Zoom link.
4. Unpaid people get "complete your registration" emails at +24h and +72h (editable in Admin → Automations).

### Retreat (Double £285, Single £345 per person; £50 per person deposit)
1. Step 1 posts to `POST /api/retreat/book` with the booker, every attendee and their room, and "full" or "deposit".
   The Worker works out the price (the browser never sends prices), saves the booking and attendees, and returns
   an Embedded Checkout session. Going back to edit updates the same unpaid booking.
2. After paying, the browser returns via `/api/retreat/return`, and Stripe also calls the webhook. Whichever arrives
   first records the payment; it is only ever counted (and emailed about) once.
3. **Deposit paid**: the booker gets an email with a personal **Pay your balance** button straight away, then
   reminders 7 and 14 days after the deposit (before 28 Dec, and not while an invoice is open).
4. **Invoice**: in the dashboard, open a booking → **Send Stripe invoice**. Stripe emails a hosted invoice; when it
   is paid (`invoice.paid`) the booking updates and the confirmation goes out. While an invoice is open the online
   balance link is paused so nobody pays twice. If the balance is paid another way, the open invoice is voided.
5. **Bank transfer or cash**: dashboard → **Record payment**.
6. Refunds (from the dashboard or Stripe) update the booking (`charge.refunded`).

`retreat_bookings.amount_paid` is always recalculated in the database from `retreat_payments`.

## Preview: test it before the domain moves
A second Worker, **`landingpage-preview`**, serves the same site on Cloudflare's free address
(`https://landingpage-preview.<your-account>.workers.dev`). It is set up in `wrangler.jsonc` under `env.preview`.

**It is password-protected.** Add a secret `PREVIEW_PASSWORD` to the `landingpage-preview` Worker (Settings →
Variables and Secrets → type Secret). Until it is set, the preview answers "locked". The browser asks for a username
and password: type anything as the username and the preview password. Stripe's webhook is exempt, because it signs
its own messages.

How it differs from the real site:
- No custom domains. The dashboard is at `/landing/admin/` and the student portal at `/landing/lms/` on the preview address.
- **No scheduled emails.** It uses the real database, so the automatic reminders are switched off, and so are
  "Process queue now" and "Sync with Stripe" in its dashboard. Emails still go out for things you do yourself
  (booking confirmations, balance links), and every link in them points back at the preview.
- Hidden from search engines. Sender name shows "(TEST)".
- Use **Stripe test keys** only.

### One-time setup
1. `npm install`, then `npx wrangler login` (opens Cloudflare in your browser).
2. Stripe (in **Test mode**): Developers → API keys. Copy the **publishable key** into `wrangler.jsonc` →
   `env.preview.vars.STRIPE_PUBLISHABLE_KEY`.
3. `npm run preview:deploy`. The output ends with the preview address. Note it.
4. Stripe (Test mode) → Developers → Webhooks → Add endpoint: `<preview address>/api/stripe-webhook`, with the six events
   listed under "Stripe" below. Copy its signing secret (`whsec_…`).
5. `npm run preview:secrets` asks for four values, one at a time: the Supabase **service role** key (Supabase →
   Project settings → API keys), the Stripe **test** secret key (`sk_test_…`), the webhook signing secret from step 4,
   and the Resend API key.
6. Optional, for portal sign-in links: Supabase → Auth → URL configuration → add `<preview address>/**` to Redirect URLs.

### Testing
Open the preview address on your phone or laptop. Pay with the test card **4242 4242 4242 4242**, any future date and any CVC.
Use **your own email** and names like "Test Booker", because these bookings are saved in the real database.
Try: a bootcamp registration; a retreat booking in full; a retreat deposit, then the "Pay your balance" email;
then in `/landing/admin/` → Retreat: send an invoice, record a payment, refund.

When you've finished, ask Claude Code to remove the test registrations and bookings (by email address), so test people
don't get the real reminder emails or portal access later. Redeploy the preview after changes with `npm run preview:deploy`.

## Setup and going live

### 1. Supabase (done)
Migrations `0001`–`0005` are applied to `kingdom-school` (London). New migrations: add `supabase/migrations/000N_name.sql`
and apply it (Supabase SQL editor, `supabase db push`, or ask Claude Code).
- Auth → URL configuration: Site URL `https://dashboard.thearimatheaacademy.com/` (also in Redirect URLs).
- Recommended: Auth → Providers → Email → turn on **leaked password protection**.
- Create an admin: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run create-admin -- name@example.com 'StrongPassword'`

### 2. Stripe
- Webhook endpoint: `https://thearimatheaacademy.com/api/stripe-webhook`, with the events
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`,
  `invoice.paid`, `invoice.voided`, `invoice.marked_uncollectible`.
- Settings → Branding: logo and colours (green `#23571F`) so the embedded form and invoices match the site.
- Settings → Invoices: add the business name, address and footer you want on invoices.
- Put the **publishable** key (`pk_test_…`, later `pk_live_…`) in `wrangler.jsonc` → `STRIPE_PUBLISHABLE_KEY`.
- The Worker pins Stripe API version `2024-06-20` on its own requests, so dashboard upgrades don't break it.

### 3. Resend
Verify the sending subdomain `kingdomschool.thearimatheaacademy.com` (SPF/DKIM records in Cloudflare DNS) and create an API key.

### 4. Domain: GoDaddy → Cloudflare (the whole site)
1. In Cloudflare, add the site `thearimatheaacademy.com` (Free plan). It imports the DNS records. Check the **MX**
   and other email records match GoDaddy's exactly, so email keeps working.
2. In GoDaddy: Domain → Nameservers → "I'll use my own" → the two Cloudflare nameservers. Wait for it to show Active.
3. In Cloudflare DNS, **delete the A/AAAA/CNAME records for `thearimatheaacademy.com` and `www`** (the old website).
   The Worker's custom domains create their own records on deploy, and can't while old ones exist. Keep MX/TXT records.

### 5. Deploy
```
npm install
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npm run deploy
```
Or connect the GitHub repo in Cloudflare (Workers → Create → Import a repository) so every push to `main` deploys.

**Test first with Stripe test keys** (card `4242 4242 4242 4242`): a bootcamp registration, a retreat booking paid
in full, a deposit then the balance link, a dashboard invoice, a recorded bank transfer and a refund. Then switch
to live keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` for the live webhook, `STRIPE_PUBLISHABLE_KEY`).

## Development
```
cp .dev.vars.example .dev.vars    # fill in test keys
npm run dev                       # http://localhost:8787
npm test                          # unit tests (no network)
```
To receive webhooks locally: `stripe listen --forward-to localhost:8787/api/stripe-webhook`.
Note: `npm run dev` points at the real Supabase project. Use Stripe **test** keys, and don't create test bookings with
real people's emails.
