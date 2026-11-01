# To do

## Before going live (Moi)
- [ ] **Domain to Cloudflare**: add the site in Cloudflare, switch GoDaddy nameservers, check email (MX) records came across,
      then delete the old website's A/CNAME records for `thearimatheaacademy.com` and `www`. See README, "Domain".
- [ ] **Stripe**: add the webhook (README lists the URL and 6 events), branding (logo, green `#23571F`), invoice
      business details. Put the publishable key in `wrangler.jsonc` → `STRIPE_PUBLISHABLE_KEY`.
- [ ] **Secrets** in Cloudflare (`wrangler secret put …`): `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
      `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Then `npm run deploy` (or connect the repo in Cloudflare).
- [ ] **Resend**: verify `kingdomschool.thearimatheaacademy.com`.
- [ ] **Test end to end with Stripe test keys** before switching to live keys: bootcamp; retreat in full; retreat deposit
      then balance link; dashboard invoice; recorded bank transfer; refund.
- [ ] **Repoint tinyurl.com/thekingdomway** from the Google Form to `https://thearimatheaacademy.com/register/`.
- [ ] Supabase Auth: turn on **leaked password protection** (security advisor warning).

## Waiting on Moi (content)
- [ ] **Retreat balance due date** and **refund terms for retreat payments** (`[PLACEHOLDER]`s in `public/terms/`).
- [ ] Confirm bootcamp refund terms and the privacy policy (both pages say "Draft for review").
- [ ] **Retreat venue name** and **what's included** (meals, sessions). Retreat page and emails don't name the venue yet.
- [ ] **Room capacity**: is there a limit on rooms? Booking currently has no cap ("Limited rooms" is only text).
- [ ] **Book buy link**: "BUY THE BOOK" on the home page goes nowhere yet (Amazon/Selar link, or a Stripe Payment Link for £10).
- [ ] Confirm or rewrite drafted copy (see `docs/CONTENT.md`).
- [ ] **Logo file** (gold lion and crown) in high resolution: use it in the header and regenerate the favicon.
- [ ] Newsletter provider (Mailchimp / Brevo / Kit / MailerLite) for the home page sign-up form (not connected yet).
- [ ] Original speaker photos, if available (current ones are cut out of flyers).

## Build next (suggested order)
1. [x] Mobile header (31 Oct). 2. [x] Registration + payment forms, bootcamp and retreat (1 Nov).
3. [ ] Retreat emails editable in the dashboard (today they are templates in `src/retreat.js`).
4. [ ] Remaining pages from the site map, same header/footer: `about`, `events`, `books`, `contact`; then point the nav at them.
5. [ ] Social sharing image (`og:image`, 1200×630) per page and `<link rel="canonical">`.
6. [ ] Compress speaker PNGs to WebP (~160–200 KB each).
7. [ ] Add a Cloudflare rate-limiting rule for `/api/register` and `/api/retreat/book` (stops form spam creating Stripe sessions).
8. [ ] Consider moving one-to-one booking from Coachli to on-site later. Not urgent.

## Nice to have
- [ ] Analytics (Cloudflare Web Analytics is free and needs no cookie banner).
- [ ] Add Group Mentorship back when it relaunches (removed on request).
- [ ] Testimonials section, only with real, permissioned quotes.
