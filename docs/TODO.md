# To do

## Launch (1 Nov 2026)
- [x] Preview Worker (`landingpage-preview`, workers.dev) tested with Stripe test keys.
- [x] Domain moved from GoDaddy to Cloudflare; old website DNS records removed.
- [x] Pull request merged into `main`; `landingpage` Worker builds from `main` on every push.
- [x] Live site on `thearimatheaacademy.com`, `www`, `dashboard.` and `lms.`; email cron running again.

## Still to do after launch (Moi)
- [x] Applied `0009_email_amounts_follow_plan.sql` after the instalments release went live (12 Nov).
- [ ] Decide what to tell RT-80DE67 about the postponed retreat (keep the deposit for new dates, or refund from Dashboard → Retreat).
- [ ] Confirm the instalment wording in `/terms/` (drafted).
- [ ] Add the secret **`PREVIEW_PASSWORD`** to `landingpage-preview` (the preview is locked until you do).
- [ ] Supabase → Authentication → Providers → Email: confirm **"Confirm email" is on** (audit item needing validation).
- [ ] Delete the two leftover routes on `landingpage`: `thearimatheaacademy.com/landing*` and `www.thearimatheaacademy.com/landing*` (not needed; the Worker redirects old `/landing` links itself).
- [ ] Confirm `landingpage-preview` only has its workers.dev address (no custom domains).
- [ ] Supabase Auth → URL configuration: Site URL `https://dashboard.thearimatheaacademy.com/`; turn on **leaked password protection**.
- [ ] Resend: `kingdomschool.thearimatheaacademy.com` shows **Verified** (its DNS records must be in Cloudflare).
- [ ] One real £50 retreat deposit with your own email: check the email, the dashboard, then refund it.
- [ ] Repoint **tinyurl.com/thekingdomway** to `https://thearimatheaacademy.com/register/`.
- [ ] Tell Claude Code which test registrations/bookings to remove (one unpaid registration was created on 1 Nov).

## How changes go live from now on
Claude Code pushes to the `website-cloudflare-checkout` branch → it builds the preview → you check it →
merge into `main` → the live site rebuilds automatically.

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
