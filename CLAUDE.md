# The Arimathea Academy website: briefing for Claude Code

Read this first, then `docs/TODO.md` for what to do next. `docs/DECISIONS.md` explains why things are the way they are;
`docs/CONTENT.md` holds the facts (dates, prices, links) that must stay correct. `README.md` explains payments and setup.

## What this is
The website, registrations and payments for **The Arimathea Academy** (Visioneer: Pastor/Coach Collins Imadojemu), a
UK-based Christian mentorship and teaching organisation. It promotes and takes bookings for:
- **Kingdom School of Business and Ministry Bootcamp**: 15 weeks online, starts Fri 11 Dec 2026, £150 (`/bootcamp/`, `/register/`)
- **End of Year Retreat**: 28–31 Dec 2026, Leicestershire, Double £285 / Single £345 per person, £50 deposit (`/retreat/`, `/retreat/book/`)
- **One-to-one sessions**: Clarity Session (60/90 mins) and From Ideas to Implementation (booked on Coachli)
- **Addiction to Freedom**: recovery programme (Foundation / Restoration, booked on Coachli)
- **Book**: *Running on Bended Knees* by Collins Imadojemu, £10

Owner and editor: Moi (Omolara Ogundele). She is comfortable with HTML/CSS and Python; write clear, plain explanations, UK English.

**Real people are registered.** The Supabase project `kingdom-school` holds live registrants. Never run destructive SQL,
never create test rows with real emails, and dry-run migrations (e.g. inside a transaction that aborts) before applying.

## Stack
- **One Cloudflare Worker** (`src/`) serves the whole domain: static pages from `public/`, the API under `/api/`,
  the Stripe webhook, and a cron (every 5 min) for automated emails. `wrangler.jsonc` has the routes and variables.
- **Supabase** (Postgres + Auth): registrants, retreat bookings/attendees/payments, emails, admin and student logins. RLS on every table.
- **Stripe**: Embedded Checkout (payment step of the forms), Invoices (retreat balances), webhook. API version pinned in `src/stripe.js`.
- **Resend** for email. No build step for the pages: plain HTML + `public/assets/css/site.css` + small JS files.
- Fonts from Google Fonts: Anton (display), Oswald (labels/buttons/nav), Poppins (body).

## Layout
```
public/                       ← everything the browser loads
  index.html                  Home
  bootcamp/  retreat/  programmes/      main pages
  register/                   bootcamp 2-step registration
  retreat/book/  retreat/booked/        retreat 2-step booking + thank-you
  success/  cancelled/  privacy/  terms/  404.html
  assets/css/site.css         shared tokens, header, forms/checkout, content pages
  assets/js/site.js           mobile menu (every page)
  assets/js/checkout.js       2-step form helpers + Stripe embedded checkout
  assets/js/programmes.js     60/90 and Foundation/Restoration pickers (prices + links live here)
  assets/img/                 gold texture, speakers/, coach-collins.png, book cover
  landing/admin/  landing/lms/          dashboard and student portal (served on their subdomains)
  landing/icons/  landing/img/          assets those two use
src/index.js                  routing, bootcamp API, webhook, admin API
src/retreat.js                retreat prices, booking, payments, emails, reminders, admin actions
src/stripe.js  src/email.js   Stripe calls; email sending and the bootcamp scheduler
supabase/migrations/          database schema (applied in order)
test/                         node --test unit tests (fake Supabase, fake Stripe)
scripts/                      create-admin, and one-off import scripts (guarded; do not re-run)
docs/                         decisions, content facts, TODO, copy
source-material/              original flyers and book cover (not deployed)
```

## Conventions (follow these when editing or adding pages)
- **`public/` is the source of truth.** Edit the HTML directly.
- Links are **absolute from the site root** (`/programmes/#sessions`, `/assets/img/...`). Preview with `npm run dev`.
- Styling on the main pages is mostly inline `style=""` (inherited from the design canvas). Form/content pages use
  classes in `site.css`. Keep new work consistent; if you refactor, keep the visual result identical.
- Every page uses the **same header** (logo, nav, page-specific CTA) and a footer. Copy the header from an existing
  page. Mark the active nav item with `aria-current="page"`.
- Section rhythm: content max-width 1240px, side padding 24px, section padding ~96–104px vertical. Layouts use
  `flex-wrap`/`grid auto-fit` so they stack on phones; there must be **no horizontal scroll at 390px**.
- Accessibility: real `<a>`/`<button>`/`<label>`, touch targets ≥44px, `alt` on content images, decorative SVG
  `aria-hidden="true"`, text contrast ≥4.5:1, form errors announced (`role="alert"`).
- **Prices are decided on the server** (`src/retreat.js` ROOMS/DEPOSIT, `src/stripe.js` bootcamp). The page copies are
  display only; change both together and update `docs/CONTENT.md`.

## Design system (green, cream and gold, taken from the bootcamp flyers)
| Token | Hex | Use |
|---|---|---|
| green-deep | `#1E3A1B` | header, dark bands, footer, featured cards |
| green | `#23571F` | primary buttons, links, small headings |
| green-hover | `#163A13` | button hover |
| green-bright | `#3B8036` | second half of two-tone headlines |
| grey-headline | `#5F5F5F` | first half of two-tone headlines |
| text | `#2B2A24` | body text |
| text-on-dark | `#E8E2CC` | body text on green |
| cream | `#FBF5E3` | page background |
| cream-2 | `#F3E9CB` | alternate section background |
| border | `#E6DCBE` | card borders, dividers |
| gold | `#E9D08A` | gold buttons, accents on dark green |
| gold texture | `#E9D28C` + `assets/img/gold-texture.jpg` | `.gold` sections (brushed metal look) |
| bronze | `#B8862E` | corner triangles, thin divider lines |
| gold-rule | `#C9A24A` | short bars above headings |
| eyebrow-brown | `#8A6420` | small letter-spaced labels on cream |

Signature patterns: two-tone uppercase Anton headline (grey then bright green); Oswald eyebrow label (0.3em
letter-spacing); bronze corner triangle bottom-right of gold heroes and footers; square-cornered Oswald uppercase
buttons (green `.cta` on light, gold `.cta-gold` on dark). No emoji, no gradients, no rounded "app" cards.

## Rules from the client (don't undo these)
- Green and cream across the whole site.
- **No Coach Collins intro section on the home page.**
- 60/90 min Clarity Sessions are **one card with a picker**, not two products. Same for Foundation/Restoration.
- **Group Mentorship is removed for now.** Don't re-add it until asked.
- On retreat and coaching materials he is **"Coach Collins"**; on the bootcamp speaker list he is "Pastor Collins Imadojemu". Surname is spelled **Imadojemu**.
- Retreat: **one person can book and pay for several attendees**; after a deposit an **automatic balance payment link** is
  emailed, and admins can also **invoice manually** from the dashboard.
- Don't invent testimonials, stats or claims. Use `[PLACEHOLDER]` text for anything unknown and list it in `docs/TODO.md`.
- Addiction to Freedom involves health data (special category data under UK GDPR): keep forms minimal, clear privacy
  notice, no promises like "completely confidential" unless the client confirms them.

## Checking your work
- `npm test` must pass.
- `npm run dev`, then check pages at 1440px and 390px: no horizontal scroll; headers and grids wrap cleanly.
- `/programmes/`: click 90 mins and Restoration: price, label, inclusions and booking link all change.
- `/register/` and `/retreat/book/`: validation messages, step 2 shows the payment form, "Edit" returns to step 1.
- Link check: every local `href`/`src` resolves and every `#anchor` exists.
- After a DB change, run the Supabase security advisor.
