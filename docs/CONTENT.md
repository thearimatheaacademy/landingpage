# Content facts (keep these correct)

Everything here was supplied by Moi unless marked *(drafted)*. Drafted copy was written by Claude and should be checked with her before launch.

## Organisation
- Website: **https://thearimatheaacademy.com** · Dashboard: dashboard.thearimatheaacademy.com · Student portal: lms.thearimatheaacademy.com
- Name: **The Arimathea Academy**
- Visioneer: **Collins Imadojemu**, Lead Pastor of Shekinah Nation. Titled **"Coach Collins"** on Academy retreat and coaching materials.
- Email: **info@thearimatheaacademy.com**
- Instagram: **@thearimatheaacademy**
- Phone / WhatsApp: **07412 045045** (`tel:+447412045045`)
- Mission line used on the site: "raise Kingdom sons and daughters who prosper and make an impact, through mentorship, discipleship and practical teaching" *(drafted from his bootcamp bio)*
- Home headline "Raising Kingdom builders & leaders" *(drafted)*

## Kingdom School of Business and Ministry Bootcamp (`/bootcamp/`, register at `/register/`)
- Starts **Friday 11 December 2026**, **every Friday for 15 weeks**, **online via Zoom**
- Programme fee **£150**
- "Your place will be confirmed once your payment has been verified." "Registration is compulsory."
- Registration: **https://thearimatheaacademy.com/register/** (all buttons on the site go here).
  The flyer link **tinyurl.com/thekingdomway** still points at the old Google Form: repoint it to the register page (see TODO).
- Price set in code: `src/stripe.js` (£150, or `STRIPE_PRICE_ID`).
- Full original copy: `docs/content/bootcamp-copy-original.txt`
- Speakers (order as on the flyers):
  1. Pastor Kingsley Okonkwo — Life Coach and Finance Expert
  2. Apostle Femi Lazarus — Founder, International School of Ministry (ISM) · Set Man, Light Nation Church
  3. Pastor Collins Imadojemu — Lead Pastor, Shekinah Nation · Visioneer, The Arimathea Academy
  4. Henry Obot — Career and Business Coach
  5. Dr Gospel Obele — Economic Strategist and Funding Expert
  6. Dr Oluwatobi Kolawole — Leadership Coach and Mentor
  7. Aniekeme Ekwo — AI Specialist
  8. Raphael Anene — LinkedIn Expert

## End of Year Retreat (`/retreat/`, book at `/retreat/book/`)
- **Mon 28 – Thu 31 December 2026**, **Leicestershire** (venue not yet given)
- Packages: **Double occupancy £285** (share a room with one other attendee) · **Single occupancy £345** (private room) · **Non-refundable deposit £50**
- Booking on the site (replaces Jotform). The booker gives name, email, phone; then each attendee's name, room and dietary
  needs; then pay in full or £50 per person deposit. Up to 10 people per booking.
- Prices set in code: `src/retreat.js` (`ROOMS`, `DEPOSIT_PER_PERSON`) and shown in `public/retreat/book/index.html`.
- Balance after a deposit: emailed payment link, reminders at +7 and +14 days, or a Stripe invoice from the dashboard.
- Balance due date: **not yet given** (`[PLACEHOLDER]` in `/terms/`).
- *(drafted)* invitation text, the four "What to expect" items, "Limited rooms", and the tagline "Step away. Be refreshed. Close the year well."

## One-to-one sessions (`/programmes/#sessions`), currently booked on Coachli
| Session | Length | Price | Booking link |
|---|---|---|---|
| The Clarity Session | 60 mins, video call | **£100** | https://www.coachli.co/thearimatheaacademy/session/the-clarity-session?id=13417 |
| The Clarity Session | 90 mins, video call | **£150** | https://www.coachli.co/thearimatheaacademy/session/90mins-clarity-session?id=13418 |
| From Ideas to Implementation | 60 mins, video call | **£100** | https://www.coachli.co/thearimatheaacademy/session/from-ideas-to-implementation?id=13419 |

Clarity copy (Moi's): "There is a particular kind of exhaustion that comes not from overwork, but from moving in the wrong direction for too long… you leave with direction." For the person who is not lost, but who needs to find their footing again. Ideal for those navigating transition; founders and creatives overwhelmed by too many ideas; individuals with drive who need clarity to channel it.

Ideas to Implementation copy (Moi's): "Ideas, by themselves, do not build anything…" Structuring your vision, building systems that sustain execution, developing the discipline that turns intention into momentum. For entrepreneurs, creatives, community builders and leaders.

## Addiction to Freedom (`/programmes/#recovery`)
Intro (Moi's): "The cycle you are in did not begin overnight. And the way out is rarely a single decision — it is a structured process of rebuilding from within. Addiction to Freedom is that process."

| Pathway | Price | Delivery | Link |
|---|---|---|---|
| Foundation | **£200** | 4 weeks, self-paced | https://www.coachli.co/thearimatheaacademy/PS-G8Ug1 |
| Restoration | **£2,500** | 4 months | https://www.coachli.co/thearimatheaacademy/PS-jbLca |

Foundation includes: full pre-recorded Addiction to Freedom programme; the 5R and 5S Recovery Frameworks; recovery worksheets and guided reflection exercises; habit and structure templates; one session with the mentor; private community access and lifetime programme access.

Restoration includes: all Foundation materials and community access; three private mentoring and support sessions; personalised recovery guidance and implementation support; accountability check-ins and progress reviews; priority community access.

## Book
- ***Running on Bended Knees*** — *How to Build Your Altar and Stay Consistent in the Secret Place* — by Collins Imadojemu — **£10**
- Cover: `public/assets/img/book-running-on-bended-knees.jpg` (original in `source-material/`)
- Buy link: **not yet provided**

## Removed for now
- The Arimathea Academy **Group Mentorship** (was on the Linktree). Removed at Moi's request on 27 Oct 2026.

## Drafted copy added 1 Nov 2026 (check with Moi)
- Retreat booking page intro, form labels and help text; booking confirmation page.
- Retreat emails (`src/retreat.js`): deposit received, paid in full, balance link and reminders. They promise
  "We will be in touch with the venue details and everything you need to know before the retreat."
- Privacy policy and terms (both marked *Draft for review* on the pages).
