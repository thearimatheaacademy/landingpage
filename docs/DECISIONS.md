# Decisions log

Newest last. "Moi" = the client/owner. "Claude" = recommendation made during the design sessions.

| # | Date | Decision | Who / why |
|---|---|---|---|
| 1 | 26 Oct 2026 | Bootcamp landing page modelled on a masterclass sales-page structure (hero → problem/questions → topics → speakers → who it's for → why join → price → CTA). | Moi shared a reference masterclass page (6figureexpertbiz.com, built on GoHighLevel). Its fake-looking celebrity testimonials were **not** copied. |
| 2 | 26 Oct | Visual style taken from the bootcamp flyers: brushed gold, green, grey two-tone Anton headlines, bronze corner triangle. | Matches existing promo graphics. |
| 3 | 26 Oct | The first gold texture was cut from a flyer and showed a repeating "KINGDOM" watermark with seams; replaced with a **generated seamless brushed-gold texture** (`gold-texture.jpg`). | Moi flagged it as uncoordinated. |
| 4 | 26 Oct | Speaker photos cropped from the flyer speaker cards, with the gold strip above the green box cut out to transparency so heads sit cleanly. | No original photos supplied. Swap for originals if they become available. |
| 5 | 26 Oct | Apostle Femi's role shortened to "Founder, ISM · Set Man, Light Nation Church" on cards; speaker role lines fixed to equal height so rows align. | Alignment polish. |
| 6 | 26 Oct | Registration: Moi wants a form that collects answers, takes **Stripe** payment, emails a confirmation and saves registrants, replacing the Google Form/Jotform. | **Resolved by #19–#23**: custom 2-step forms on the site, Stripe, Supabase, Resend. |
| 7 | 26 Oct | Hosting recommendation: **Netlify** (free), custom domain. Only `site/` is published. | Cheapest premium route. **Superseded by #20.** |
| 8 | 26 Oct | If the tinyurl stays pointed at the registration form, make a **separate** short link for the landing page, otherwise buttons loop back to the page. | Avoids a redirect loop. |
| 9 | 27 Oct | It's **one Academy website**, not separate landing pages: Home, Programmes, Coaching, Events, Books, About, Contact, policy pages. | Moi. |
| 10 | 27 Oct | **Green and cream for the whole site.** Retreat page (first built in plum and gold to match its Jotform) was switched to green and cream. | Moi. |
| 11 | 27 Oct | **No Coach Collins intro section on the home page.** | Moi. |
| 12 | 27 Oct | 60 and 90-min Clarity Sessions = **one card with a picker**; Foundation and Restoration = **one card with a picker**. Price, copy and booking link change with the choice. | Moi. |
| 13 | 27 Oct | Bookings link out to **Coachli** for now (existing setup). | Keep working payments while the site is built. |
| 14 | 27 Oct | Addiction to Freedom: replaced a drafted "everything is confidential" promise with "Begin privately and on your own terms" (Moi's own wording). | Avoid promises the Academy hasn't confirmed; UK GDPR special category data. |
| 15 | 27 Oct | **Group Mentorship removed for now.** Bootcamp became a full-width featured card on Home and Programmes. | Moi. |
| 16 | 27 Oct | **Favicon**: gold crown on deep green, rounded square (`favicon.svg/.ico`, apple-touch-icon). | Placeholder until the real lion-and-crown logo file is supplied. |
| 17 | 31 Oct | Exported from the Claude Design canvas to a plain static site for Claude Code. Shared header with nav added to the bootcamp page (it was a standalone landing page). Phone fix: bootcamp hero hides speaker names and date column under 640px. | Handoff. |
| 18 | 31 Oct | **Mobile header**: below 1100px the nav and header CTA collapse behind a menu button (header is 76px tall instead of ~210px). Header styles moved from inline to classes in `site.css` (`.site-header`, `.header-bar`, `.brand-name`, `.nav`, `.header-cta`); shared script `assets/js/site.js` on every page. Without JavaScript the full nav still shows. | 1100px is the narrowest width where logo, nav and the longest CTA fit on one row. |
| 19 | 31 Oct | A registration system already existed in the `thearimatheaacademy/landingpage` repo (Cloudflare Worker + Supabase `kingdom-school` + Stripe + Resend, admin dashboard, student portal) with **5 real registrants**. Build on it rather than a second system on Netlify. | Claude found it; Moi agreed. One database, one webhook, no duplicate emails. |
| 20 | 1 Nov | **Move the whole website to Cloudflare** (one Worker serves every page, the API, dashboard and portal). `netlify.toml` dropped. Old `/landing/...` links keep working (redirects; `/landing/api/...` still answers) because emails already sent use them. | Moi. |
| 21 | 1 Nov | **2-step checkout** for bootcamp and retreat: step 1 details, step 2 Stripe **Embedded Checkout** on our own page (people never leave the site). | Moi chose embedded over redirecting to Stripe. |
| 22 | 1 Nov | Retreat: **one person can book and pay for several attendees** (up to 10 per booking), each with their own room choice and dietary needs. Pay in full, or **£50 deposit per person**. | Moi. |
| 23 | 1 Nov | After a deposit, an **automatic balance payment link** is emailed (plus reminders at 7 and 14 days), and admins can **send a Stripe invoice** from the dashboard or record a bank transfer. While an invoice is open the link and reminders pause so nobody pays twice. | Moi. |
| 24 | 1 Nov | Retreat data lives in new tables (`retreat_bookings`, `retreat_attendees`, `retreat_payments`), separate from bootcamp `registrants`, so retreat bookers don't get bootcamp emails or portal access. Amount paid is recalculated in the database from the payments table, and each Stripe session/invoice can only count once. | Data safety. |
| 25 | 1 Nov | Stripe API version pinned to `2024-06-20` in the Worker. | Stops a dashboard API upgrade from silently changing request/response shapes. |

## Where the design lives
- Live canvas (Claude Design artifact, private to Moi): "KSBM Bootcamp Landing Page", artboards Home, Bootcamp, Retreat,
  Programmes. Frozen at the 27 Oct state; **`public/` is ahead of it** and is the source of truth.
