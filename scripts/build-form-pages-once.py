"""ONE-OFF (already run): wrote the form and content pages in public/. public/ is now the source of truth; edit those files directly. Re-running overwrites them."""
import re
from pathlib import Path

import sys
if '--force' not in sys.argv:
    sys.exit('Refusing to run: public/ is the source of truth.')
PUB = Path(__file__).resolve().parent.parent / 'public'
home = (PUB / 'index.html').read_text()
HEAD_TPL = home[: home.index('<body>')]
HEADER_TPL = re.search(r'<header class="site-header">.*?</header>', home, re.S).group(0)


def head(title, desc, noindex=False):
    h = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', HEAD_TPL)
    h = re.sub(r'(<meta (?:name="description"|property="og:description") content=")[^"]*"', lambda m: m.group(1) + desc + '"', h)
    h = re.sub(r'(<meta property="og:title" content=")[^"]*"', lambda m: m.group(1) + title + '"', h)
    if noindex:
        h = h.replace('</head>', '<meta name="robots" content="noindex">\n</head>')
    return h


def header(current=None, cta=('BOOK A SESSION', '/programmes/#sessions')):
    h = HEADER_TPL
    if current:
        h = h.replace(f'<a href="{current}">', f'<a href="{current}" aria-current="page">', 1)
    return re.sub(r'<a class="cta-gold header-cta" href="[^"]*">[^<]*</a>', f'<a class="cta-gold header-cta" href="{cta[1]}">{cta[0]}</a>', h)


FOOTER = '''<footer class="site-footer">
<div class="corner" aria-hidden="true"></div>
<div class="inner">
<span class="brand">THE ARIMATHEA ACADEMY</span>
<span><a href="mailto:info@thearimatheaacademy.com">info@thearimatheaacademy.com</a> · <a href="tel:+447412045045">07412 045045</a> · © 2026 The Arimathea Academy · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms &amp; refunds</a></span>
</div>
</footer>'''


def page(path, title, desc, body, current=None, cta=None, scripts=(), noindex=False):
    html = (head(title, desc, noindex) + '<body>\n<div style="font-family: \'Poppins\', system-ui, sans-serif; color: #2B2A24; background: #FBF5E3; width: 100%; overflow-x: hidden">\n\n'
            + header(current, cta or ('BOOK A SESSION', '/programmes/#sessions')) + '\n\n' + body.strip() + '\n\n' + FOOTER + '\n</div>\n'
            + ''.join(f'<script src="{s}" defer></script>\n' for s in ('/assets/js/site.js', *scripts)) + '</body>\n</html>\n')
    out = PUB / path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(path, len(html))


def hero(eyebrow, grey, green, lede, steps=None):
    s = ''
    if steps:
        cur = ' aria-current="step"'
        s = '<ol class="steps" aria-label="Progress">' + ''.join('<li' + (cur if i == 0 else '') + '>' + t + '</li>' for i, t in enumerate(steps)) + '</ol>'
    return f'''<section class="gold page-hero" style="position: relative; overflow: hidden">
<div style="position: absolute; right: 0; bottom: 0; width: 0; height: 0; border-left: 150px solid transparent; border-bottom: 96px solid #B8862E" aria-hidden="true"></div>
<div class="inner" style="position: relative">
<div class="eyebrow">{eyebrow}</div>
<h1 class="page-title">{grey} <span>{green}</span></h1>
<p class="lede">{lede}</p>
{s}
</div>
</section>'''


CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E9D08A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>'
TERMS = '''<label class="check"><input type="checkbox" name="accept_terms" required> <span>I agree to the <a href="/terms/" target="_blank" rel="noopener">terms &amp; refund policy</a> and <a href="/privacy/" target="_blank" rel="noopener">privacy policy</a>.</span></label>
<label class="check"><input type="checkbox" name="marketing_consent"> <span>Keep me updated about future Arimathea Academy programmes and events.</span></label>'''

# ───────────────────────── Bootcamp registration ─────────────────────────
register = hero('KINGDOM SCHOOL OF BUSINESS &amp; MINISTRY BOOTCAMP', 'Secure', 'your place',
                '15 weeks, every Friday on Zoom, starting Friday 11 December 2026. Registration takes two quick steps.',
                ['Your details', 'Payment']) + f'''
<div class="checkout">
<div class="checkout-main">

<section data-step="1" aria-labelledby="s1-title">
<form id="details" class="panel" novalidate>
<h2 class="panel-title" id="s1-title">Your details<small>We will send your confirmation and Zoom link to this email address.</small></h2>
<div class="form-error" id="err1" role="alert"></div>
<div class="form-grid">
<div class="field"><label for="first_name">First name</label><input id="first_name" name="first_name" autocomplete="given-name" required maxlength="100"></div>
<div class="field"><label for="last_name">Last name</label><input id="last_name" name="last_name" autocomplete="family-name" required maxlength="100"></div>
</div>
<div class="form-grid">
<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
<div class="field"><label for="phone">Phone / WhatsApp</label><input id="phone" name="phone" type="tel" autocomplete="tel" required maxlength="40" placeholder="+44 7700 900000"></div>
</div>
<div class="form-grid">
<div class="field"><label for="country">Country</label><input id="country" name="country" autocomplete="country-name" maxlength="80" value="United Kingdom"></div>
<div class="field"><label for="organisation">Church or organisation <span class="opt-label">(optional)</span></label><input id="organisation" name="organisation" maxlength="200"></div>
</div>
<div class="field"><label for="how_heard">How did you hear about the bootcamp? <span class="opt-label">(optional)</span></label>
<select id="how_heard" name="how_heard"><option value="">Select…</option><option>Church announcement</option><option>Instagram</option><option>Facebook</option><option>WhatsApp</option><option>LinkedIn</option><option>Friend or family</option><option>Other</option></select></div>
<div class="field"><label for="goals">What are you hoping to build? <span class="opt-label">(optional)</span></label><textarea id="goals" name="goals" rows="3" maxlength="2000"></textarea></div>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
{TERMS}
<button class="btn-primary" id="go" type="submit">Continue to payment</button>
<p class="note">Nothing is charged until you confirm on the next step.</p>
</form>
</section>

<section data-step="2" aria-labelledby="s2-title" hidden>
<div class="panel">
<h2 class="panel-title" id="s2-title">Payment<small>Pay securely by card, Apple Pay or Google Pay. Payments are processed by Stripe.</small></h2>
<div class="form-error" id="err2" role="alert"></div>
<div class="paying-as"><span id="paying-as"></span><button class="ghost-btn" type="button" id="edit">Edit details</button></div>
<div id="checkout"></div>
</div>
</section>

</div>

<aside class="checkout-side" aria-label="Order summary">
<div class="summary">
<div class="summary-label">YOUR ORDER</div>
<h2>Kingdom School Bootcamp</h2>
<dl>
<dt>Programme fee</dt><dd>£150</dd>
<div class="rule" role="presentation"></div>
<div class="due" style="display: contents"><dt>Total</dt><dd>£150</dd></div>
</dl>
<ul class="facts">
<li><strong>Starts:</strong> Friday, 11 December 2026</li>
<li><strong>When:</strong> Every Friday for 15 weeks</li>
<li><strong>Where:</strong> Online via Zoom</li>
</ul>
<div class="secure">{CHECK}<span>Your place is confirmed once payment is received. Your confirmation email includes the Zoom link.</span></div>
</div>
</aside>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {{
  var C = window.Checkout, form = document.getElementById('details'), err1 = document.getElementById('err1'), err2 = document.getElementById('err2');
  var go = document.getElementById('go'), box = document.getElementById('checkout');

  function toPayment(out) {{
    document.getElementById('paying-as').innerHTML = 'Registering <strong>' + C.escapeHtml(out.registrant.first_name + ' ' + out.registrant.last_name) + '</strong> (' + C.escapeHtml(out.registrant.email) + ')';
    C.setStep(2);
    return C.mount(out.client_secret, box).catch(function (e) {{ C.showError(err2, e.message); }});
  }}

  form.addEventListener('submit', function (e) {{
    e.preventDefault();
    C.clearError(err1);
    var d = Object.fromEntries(new FormData(form));
    form.querySelectorAll('[aria-invalid]').forEach(function (el) {{ el.removeAttribute('aria-invalid'); }});
    function bad(id, msg) {{ document.getElementById(id).setAttribute('aria-invalid', 'true'); C.showError(err1, msg); }}
    if (!d.first_name.trim()) return bad('first_name', 'Please enter your first name.');
    if (!d.last_name.trim()) return bad('last_name', 'Please enter your last name.');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(d.email.trim())) return bad('email', 'Please enter a valid email address.');
    if (d.phone.replace(/\\D/g, '').length < 7) return bad('phone', 'Please enter your phone / WhatsApp number.');
    if (!d.accept_terms) return C.showError(err1, 'Please accept the terms to continue.');
    d.accept_terms = true; d.marketing_consent = !!d.marketing_consent;
    go.disabled = true; go.textContent = 'Please wait…';
    C.post('/register', d).then(toPayment).catch(function (e) {{ C.showError(err1, e.message); }})
      .finally(function () {{ go.disabled = false; go.textContent = 'Continue to payment'; }});
  }});

  document.getElementById('edit').addEventListener('click', function () {{ C.unmount(); C.clearError(err2); C.setStep(1); }});

  // Payment links in reminder emails open straight at step 2.
  var q = new URLSearchParams(location.search);
  if (q.get('id') && q.get('t')) {{
    C.setStep(2);
    document.getElementById('edit').hidden = true;
    C.post('/checkout', {{ id: q.get('id'), t: q.get('t') }}).then(toPayment).catch(function (e) {{
      if (e.data && e.data.paid) {{ location.href = '/success/?already=1'; return; }}
      C.showError(err2, e.message);
      document.getElementById('edit').hidden = false;
      document.getElementById('edit').textContent = 'Register again';
    }});
  }}
}});
</script>'''
page('register/index.html', 'Register | Kingdom School of Business &amp; Ministry Bootcamp', 'Register for the Kingdom School of Business and Ministry Bootcamp. 15 weeks online from Friday 11 December 2026. £150.',
     register, current='/programmes/', cta=('REGISTER NOW', '/register/'), scripts=('/assets/js/checkout.js',))

# ───────────────────────── Retreat booking ─────────────────────────
ROOM_OPTS = '<option value="double">Double occupancy · £285 (shared room)</option><option value="single">Single occupancy · £345 (private room)</option>'
book = hero('END OF YEAR RETREAT · 28 – 31 DECEMBER 2026', 'Reserve', 'your place',
            'Four days away in Leicestershire with Coach Collins. Book for yourself, or for yourself and others, and pay in full or with a £50 deposit per person.',
            ['Booking details', 'Payment']) + f'''
<div class="checkout">
<div class="checkout-main">

<section data-step="1" aria-labelledby="s1-title">
<form id="details" novalidate>
<div class="panel">
<h2 class="panel-title" id="s1-title">Your details<small>You are the contact for this booking. Confirmations and payment links go to this email address.</small></h2>
<div class="form-error" id="err1" role="alert"></div>
<div class="form-grid">
<div class="field"><label for="first_name">First name</label><input id="first_name" name="first_name" autocomplete="given-name" required maxlength="100"></div>
<div class="field"><label for="last_name">Last name</label><input id="last_name" name="last_name" autocomplete="family-name" required maxlength="100"></div>
</div>
<div class="form-grid">
<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
<div class="field"><label for="phone">Phone / WhatsApp</label><input id="phone" name="phone" type="tel" autocomplete="tel" required maxlength="40" placeholder="+44 7700 900000"></div>
</div>
</div>

<div class="panel">
<h2 class="panel-title">Who is coming?<small>Add everyone you are booking for, including yourself if you are attending. Up to 10 people per booking.</small></h2>
<div id="attendees"></div>
<button class="ghost-btn" type="button" id="add">+ Add another person</button>
</div>

<div class="panel">
<h2 class="panel-title">How would you like to pay?</h2>
<fieldset class="choice-group">
<legend class="hp">Payment option</legend>
<label class="choice"><input type="radio" name="payment_option" value="full" checked><div><strong>Pay in full</strong><span id="full-label">Pay the whole amount now.</span></div></label>
<label class="choice"><input type="radio" name="payment_option" value="deposit"><div><strong>Pay a deposit</strong><span id="deposit-label">£50 per person now (non-refundable), and the balance later.</span></div></label>
</fieldset>
<p class="note" id="deposit-note" hidden>After paying the deposit we will email you a link to pay the balance whenever you are ready. You can also ask us for an invoice.</p>
<div class="field" style="margin-top: 18px"><label for="special_requests">Anything else we should know? <span class="opt-label">(optional)</span></label><textarea id="special_requests" name="special_requests" maxlength="2000" placeholder="For example, who you would like to share a room with, or access needs."></textarea></div>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
{TERMS}
<button class="btn-primary" id="go" type="submit">Continue to payment</button>
<p class="note">Nothing is charged until you confirm on the next step.</p>
</div>
</form>
</section>

<section data-step="2" aria-labelledby="s2-title" hidden>
<div class="panel">
<h2 class="panel-title" id="s2-title">Payment<small>Pay securely by card, Apple Pay or Google Pay. Payments are processed by Stripe.</small></h2>
<div class="form-error" id="err2" role="alert"></div>
<div class="paying-as"><span id="paying-as"></span><button class="ghost-btn" type="button" id="edit">Edit booking</button></div>
<div id="checkout"></div>
</div>
</section>

</div>

<aside class="checkout-side" aria-label="Booking summary">
<div class="summary">
<div class="summary-label" id="sum-label">YOUR BOOKING</div>
<h2>End of Year Retreat</h2>
<dl id="sum-lines"></dl>
<ul class="facts">
<li><strong>When:</strong> Mon 28 – Thu 31 December 2026</li>
<li><strong>Where:</strong> Leicestershire</li>
<li><strong>Hosted by:</strong> Coach Collins</li>
</ul>
<div class="secure">{CHECK}<span>Your place is confirmed once payment is received. The deposit is non-refundable.</span></div>
</div>
</aside>
</div>

<template id="attendee-tpl">
<div class="attendee">
<div class="attendee-head"><h3>Person <span class="n"></span></h3><button class="link-btn remove" type="button">Remove</button></div>
<div class="form-grid">
<div class="field"><label>First name</label><input name="a_first" autocomplete="off" required maxlength="100"></div>
<div class="field"><label>Last name</label><input name="a_last" autocomplete="off" required maxlength="100"></div>
</div>
<div class="form-grid">
<div class="field"><label>Room</label><select name="a_room">{ROOM_OPTS}</select></div>
<div class="field"><label>Dietary needs <span class="opt-label">(optional)</span></label><input name="a_diet" maxlength="500" placeholder="e.g. vegetarian, nut allergy"></div>
</div>
</div>
</template>

<script>
document.addEventListener('DOMContentLoaded', function () {{
  var C = window.Checkout, PRICES = {{ double: 28500, single: 34500 }}, DEPOSIT = 5000, MAX = 10;
  var form = document.getElementById('details'), list = document.getElementById('attendees'), tpl = document.getElementById('attendee-tpl');
  var err1 = document.getElementById('err1'), err2 = document.getElementById('err2'), go = document.getElementById('go'), box = document.getElementById('checkout');
  var q = new URLSearchParams(location.search), saved = null; // saved = {{ id, token }} of the unpaid booking being edited
  var uid = 0;

  function rows() {{ return Array.prototype.slice.call(list.querySelectorAll('.attendee')); }}
  function addAttendee(room) {{
    var node = tpl.content.firstElementChild.cloneNode(true), id = ++uid;
    node.querySelectorAll('label').forEach(function (l, i) {{
      var input = l.nextElementSibling; input.id = 'a' + id + '-' + i; l.htmlFor = input.id;
    }});
    if (room) node.querySelector('[name=a_room]').value = room;
    node.querySelector('.remove').addEventListener('click', function () {{ node.remove(); renumber(); }});
    node.addEventListener('input', update);
    node.addEventListener('change', update);
    list.appendChild(node);
    renumber();
    return node;
  }}
  function renumber() {{
    var all = rows();
    all.forEach(function (r, i) {{
      r.querySelector('.n').textContent = i + 1;
      r.querySelector('.remove').hidden = all.length === 1;
      r.querySelectorAll('label').forEach(function (l) {{ l.dataset.base = l.dataset.base || l.textContent; }});
      r.querySelector('.remove').setAttribute('aria-label', 'Remove person ' + (i + 1));
    }});
    document.getElementById('add').disabled = all.length >= MAX;
    update();
  }}
  function attendees() {{
    return rows().map(function (r) {{
      return {{ first_name: r.querySelector('[name=a_first]').value.trim(), last_name: r.querySelector('[name=a_last]').value.trim(), room: r.querySelector('[name=a_room]').value, dietary: r.querySelector('[name=a_diet]').value.trim() }};
    }});
  }}
  function option() {{ return form.querySelector('[name=payment_option]:checked').value; }}

  // Display only: the Worker recalculates every price.
  function update() {{
    var a = attendees(), n = a.length, total = 0, counts = {{ double: 0, single: 0 }};
    a.forEach(function (x) {{ counts[x.room]++; total += PRICES[x.room]; }});
    var dep = n * DEPOSIT, opt = option(), lines = '';
    if (counts.double) lines += '<dt>' + counts.double + ' × Double occupancy</dt><dd>' + C.gbp(counts.double * PRICES.double) + '</dd>';
    if (counts.single) lines += '<dt>' + counts.single + ' × Single occupancy</dt><dd>' + C.gbp(counts.single * PRICES.single) + '</dd>';
    lines += '<div class="rule" role="presentation"></div><dt>Total</dt><dd>' + C.gbp(total) + '</dd>';
    if (opt === 'deposit') lines += '<dt>Balance to pay later</dt><dd>' + C.gbp(total - dep) + '</dd>';
    lines += '<div class="due" style="display: contents"><dt>Due today</dt><dd>' + C.gbp(opt === 'deposit' ? dep : total) + '</dd></div>';
    document.getElementById('sum-lines').innerHTML = lines;
    document.getElementById('full-label').textContent = 'Pay ' + C.gbp(total) + ' now.';
    document.getElementById('deposit-label').textContent = C.gbp(dep) + ' now (£50 per person, non-refundable), ' + C.gbp(total - dep) + ' later.';
    document.getElementById('deposit-note').hidden = opt !== 'deposit';
  }}

  // The first attendee starts as the booker; typing their own name fills it in until they change it.
  var first = addAttendee(q.get('room') === 'single' ? 'single' : 'double');
  ['first_name', 'last_name'].forEach(function (f, i) {{
    var src = document.getElementById(f), dst = first.querySelectorAll('input')[i];
    src.addEventListener('input', function () {{ if (!dst.dataset.touched) dst.value = src.value; }});
    dst.addEventListener('input', function () {{ dst.dataset.touched = '1'; }});
  }});
  if (q.get('option') === 'deposit') form.querySelector('[value=deposit]').checked = true;
  document.getElementById('add').addEventListener('click', function () {{ addAttendee().querySelector('input').focus(); }});
  form.addEventListener('change', update);
  update();

  function summary(b, dueNow, balanceMode) {{
    var lines = b.attendees.map(function (a) {{ return '<dt>' + C.escapeHtml(a.first_name + ' ' + a.last_name) + '</dt><dd>' + (a.room === 'single' ? 'Single' : 'Double') + '</dd>'; }}).join('');
    lines += '<div class="rule" role="presentation"></div><dt>Total</dt><dd>' + C.gbp(b.total) + '</dd>';
    if (b.paid) lines += '<dt>Paid so far</dt><dd>' + C.gbp(b.paid) + '</dd>';
    if (dueNow < b.total - b.paid) lines += '<dt>Balance to pay later</dt><dd>' + C.gbp(b.total - b.paid - dueNow) + '</dd>';
    lines += '<div class="due" style="display: contents"><dt>' + (balanceMode ? 'To pay now' : 'Due today') + '</dt><dd>' + C.gbp(dueNow) + '</dd></div>';
    document.getElementById('sum-lines').innerHTML = lines;
    document.getElementById('sum-label').textContent = 'BOOKING ' + b.reference;
  }}

  function toPayment(out, balanceMode) {{
    saved = {{ id: out.booking.id, token: out.booking.token }};
    summary(out.booking, out.due_now, balanceMode);
    document.getElementById('paying-as').innerHTML = 'Booking for <strong>' + out.booking.attendees.length + (out.booking.attendees.length === 1 ? ' person' : ' people') + '</strong> · contact ' + C.escapeHtml(out.booking.email);
    C.setStep(2);
    return C.mount(out.client_secret, box).catch(function (e) {{ C.showError(err2, e.message); }});
  }}

  form.addEventListener('submit', function (e) {{
    e.preventDefault();
    C.clearError(err1);
    form.querySelectorAll('[aria-invalid]').forEach(function (el) {{ el.removeAttribute('aria-invalid'); }});
    function bad(el, msg) {{ el.setAttribute('aria-invalid', 'true'); C.showError(err1, msg); }}
    var d = Object.fromEntries(new FormData(form));
    if (!d.first_name.trim()) return bad(document.getElementById('first_name'), 'Please enter your first name.');
    if (!d.last_name.trim()) return bad(document.getElementById('last_name'), 'Please enter your last name.');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(d.email.trim())) return bad(document.getElementById('email'), 'Please enter a valid email address.');
    if (d.phone.replace(/\\D/g, '').length < 7) return bad(document.getElementById('phone'), 'Please enter your phone / WhatsApp number.');
    var people = attendees();
    for (var i = 0; i < people.length; i++) {{
      if (!people[i].first_name || !people[i].last_name) return bad(rows()[i].querySelector(people[i].first_name ? '[name=a_last]' : '[name=a_first]'), 'Please enter a first and last name for person ' + (i + 1) + '.');
    }}
    if (!d.accept_terms) return C.showError(err1, 'Please accept the terms to continue.');
    var body = {{
      first_name: d.first_name, last_name: d.last_name, email: d.email, phone: d.phone, special_requests: d.special_requests,
      payment_option: option(), attendees: people, accept_terms: true, marketing_consent: !!d.marketing_consent, website: d.website,
    }};
    if (saved) {{ body.booking_id = saved.id; body.token = saved.token; }}
    go.disabled = true; go.textContent = 'Please wait…';
    C.post('/retreat/book', body).then(function (out) {{ return toPayment(out, false); }}).catch(function (e) {{ C.showError(err1, e.message); }})
      .finally(function () {{ go.disabled = false; go.textContent = 'Continue to payment'; }});
  }});

  document.getElementById('edit').addEventListener('click', function () {{ C.unmount(); C.clearError(err2); C.setStep(1); update(); }});

  // Balance links in emails: /retreat/book/?id=…&t=… opens straight at payment for what is still owed.
  if (q.get('id') && q.get('t')) {{
    document.querySelector('.page-title').innerHTML = 'Pay your <span>balance</span>';
    document.querySelector('.lede').textContent = 'Complete the payment for your End of Year Retreat booking.';
    document.getElementById('edit').hidden = true;
    C.setStep(2);
    C.post('/retreat/checkout', {{ id: q.get('id'), t: q.get('t') }}).then(function (out) {{ return toPayment(out, true); }}).catch(function (e) {{
      if (e.data && e.data.booking) summary(e.data.booking, 0, true);
      C.showError(err2, e.message);
    }});
  }}
}});
</script>'''
page('retreat/book/index.html', 'Book the End of Year Retreat | The Arimathea Academy', 'Reserve your place at the End of Year Retreat, 28 to 31 December 2026 in Leicestershire. Pay in full or with a £50 deposit.',
     book, current='/#events', cta=('RESERVE YOUR PLACE', '/retreat/book/'), scripts=('/assets/js/checkout.js',), noindex=False)

# ───────────────────────── Retreat confirmation ─────────────────────────
booked = hero('END OF YEAR RETREAT', 'Thank', 'you', 'Your payment has been received.') + '''
<main class="prose" id="main">
<div id="msg">
<p>We have emailed your confirmation. If you cannot see it within a few minutes, please check your spam or promotions folder.</p>
</div>
<p><strong>When:</strong> Monday 28 to Thursday 31 December 2026 · <strong>Where:</strong> Leicestershire</p>
<p>Questions? Reply to your confirmation email, or call or WhatsApp us on <a href="tel:+447412045045">07412 045045</a>.</p>
<p style="margin-top: 32px"><a class="cta" href="/retreat/" style="display: inline-flex; align-items: center; min-height: 54px; padding: 0 30px; background: #23571F; color: #FBF5E3; text-decoration: none; font-family: 'Oswald', sans-serif; font-weight: 500; letter-spacing: 0.16em; font-size: 15px">BACK TO THE RETREAT</a></p>
</main>
<script>
(function () {
  var q = new URLSearchParams(location.search), msg = document.getElementById('msg'), h = document.querySelector('.page-title'), lede = document.querySelector('.lede');
  var ref = (q.get('ref') || '').replace(/[^A-Z0-9-]/gi, '');
  var gbp = function (p) { return '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0 }); };
  if (q.get('processing')) {
    h.innerHTML = 'Payment <span>processing</span>';
    lede.textContent = 'Your payment is still being confirmed by your bank.';
    msg.innerHTML = '<p>We will email you as soon as it goes through. There is no need to pay again.</p>';
  } else if (q.get('status') === 'deposit_paid') {
    h.innerHTML = 'Place <span>reserved</span>';
    lede.textContent = 'Thank you, your deposit has been received' + (ref ? ' (booking ' + ref + ').' : '.');
    var bal = Number(q.get('balance')) || 0;
    msg.innerHTML = '<p>We have emailed your confirmation with a link to pay the balance' + (bal ? ' of <strong>' + gbp(bal) + '</strong>' : '') + ' whenever you are ready. You can also ask us for an invoice.</p><p>If you cannot see the email within a few minutes, please check your spam or promotions folder.</p>';
  } else {
    h.innerHTML = 'You are <span>booked</span>';
    lede.textContent = 'Thank you, your booking is paid in full' + (ref ? ' (booking ' + ref + ').' : '.');
  }
})();
</script>'''
page('retreat/booked/index.html', 'Booking received | End of Year Retreat', 'Thank you for booking the End of Year Retreat.', booked, current='/#events', cta=('RESERVE YOUR PLACE', '/retreat/book/'), noindex=True)

# ───────────────────────── Bootcamp success / cancelled ─────────────────────────
success = hero('PAYMENT RECEIVED', "You're", 'in', 'Thank you. Your place on the Kingdom School of Business &amp; Ministry Bootcamp is confirmed.') + '''
<main class="prose">
<p id="msg">We have sent a confirmation email with your <strong>Zoom link</strong> and a link to the student portal. If you cannot see it within a few minutes, please check your spam or promotions folder.</p>
<p><strong>Starts:</strong> Friday, 11 December 2026 · Every Friday for 15 weeks · Online via Zoom</p>
<p style="margin-top: 32px"><a class="cta" href="/bootcamp/" style="display: inline-flex; align-items: center; min-height: 54px; padding: 0 30px; background: #23571F; color: #FBF5E3; text-decoration: none; font-family: 'Oswald', sans-serif; font-weight: 500; letter-spacing: 0.16em; font-size: 15px">BACK TO THE BOOTCAMP</a></p>
</main>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('already')) { document.querySelector('.lede').textContent = 'You are already registered and paid for the bootcamp.'; }
  if (q.get('processing')) {
    document.querySelector('.page-title').innerHTML = 'Payment <span>processing</span>';
    document.querySelector('.lede').textContent = 'Your payment is still being confirmed by your bank.';
    document.getElementById('msg').textContent = 'We will email your confirmation and Zoom link as soon as it goes through. There is no need to pay again.';
  }
})();
</script>'''
page('success/index.html', 'Registration confirmed | Kingdom School Bootcamp', 'Your place on the Kingdom School bootcamp is confirmed.', success, current='/programmes/', cta=('REGISTER NOW', '/register/'), noindex=True)

cancelled = hero('PAYMENT NOT COMPLETED', 'Not', 'secured yet', "Your payment wasn't completed, so you haven't been charged. Your details are saved, so you can pick up where you left off.") + '''
<main class="prose">
<p><a class="cta" id="resume" href="/register/" style="display: inline-flex; align-items: center; min-height: 54px; padding: 0 30px; background: #23571F; color: #FBF5E3; text-decoration: none; font-family: 'Oswald', sans-serif; font-weight: 500; letter-spacing: 0.16em; font-size: 15px">COMPLETE PAYMENT · £150</a></p>
</main>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  if (/^[0-9a-f-]{36}$/i.test(q.get('id') || '') && /^[0-9a-f-]{36}$/i.test(q.get('t') || '')) document.getElementById('resume').href = '/register/?id=' + q.get('id') + '&t=' + q.get('t');
})();
</script>'''
page('cancelled/index.html', 'Payment not completed | Kingdom School Bootcamp', 'Your payment was not completed.', cancelled, current='/programmes/', cta=('REGISTER NOW', '/register/'), noindex=True)

# ───────────────────────── Privacy and terms (drafts) ─────────────────────────
privacy = hero('THE ARIMATHEA ACADEMY', 'Privacy', 'policy', 'How we look after the information you give us.') + '''
<main class="prose">
<p class="draft"><strong>Draft for review.</strong> Please have this checked before launch.</p>
<h2>Who we are</h2><p>The Arimathea Academy. Contact: <a href="mailto:info@thearimatheaacademy.com">info@thearimatheaacademy.com</a>, <a href="tel:+447412045045">07412 045045</a>.</p>
<h2>What we collect</h2>
<p><strong>Bootcamp registration:</strong> your name, email address and phone number, and optionally your country, church or organisation, how you heard about us and what you hope to build.</p>
<p><strong>Retreat booking:</strong> the booker's name, email address and phone number; the name and room choice of each person booked; any dietary needs or other requests you tell us about.</p>
<p>Dietary and access needs can reveal information about health or religious belief. We only use them to look after you at the retreat, share them only with the people preparing food or arranging rooms, and delete them after the retreat.</p>
<p>Payments are processed by Stripe. We never see or store your card details.</p>
<h2>How we use it</h2><p>To manage your registration or booking, confirm payments, send joining details, reminders and payment links, and, only if you opt in, to tell you about future programmes and events.</p>
<h2>Who processes it</h2><p>Supabase (database hosting), Stripe (payments and invoices), Resend (email delivery) and Cloudflare (website hosting) process data on our behalf.</p>
<h2>How long we keep it</h2><p>For the duration of the programme or retreat and up to 24 months afterwards, unless you ask us to delete it sooner or the law requires us to keep it longer (for example, payment records).</p>
<h2>Your rights</h2><p>Under UK GDPR you can ask to access, correct or delete your data, or withdraw marketing consent at any time. Email <a href="mailto:info@thearimatheaacademy.com">info@thearimatheaacademy.com</a>.</p>
</main>'''
page('privacy/index.html', 'Privacy policy | The Arimathea Academy', 'How The Arimathea Academy uses and protects your information.', privacy)

terms = hero('THE ARIMATHEA ACADEMY', 'Terms &amp;', 'refunds', 'The terms for booking our programmes and events.') + '''
<main class="prose">
<p class="draft"><strong>Draft for review.</strong> Please confirm these terms, especially refunds and the retreat balance date, before launch.</p>
<h2>Kingdom School of Business &amp; Ministry Bootcamp</h2>
<p>A 15-week online programme delivered on Zoom every Friday, starting Friday 11 December 2026. The fee is £150 per person. Registration is compulsory, and your place is confirmed once payment has been received. Joining details are personal to you and must not be shared.</p>
<p><strong>Refunds:</strong> you may request a full refund up to 7 days before the first session. After that, fees are non-refundable. If we cancel the programme you will receive a full refund.</p>
<h2>End of Year Retreat</h2>
<p>Monday 28 to Thursday 31 December 2026 in Leicestershire. Double occupancy (sharing a room with one other attendee) is £285 per person; single occupancy (private room) is £345 per person. One person can book and pay for several attendees.</p>
<p><strong>Deposit:</strong> you can reserve a place with a deposit of £50 per person. The deposit is non-refundable. The balance can be paid online using the link we email you, or by invoice on request. The balance must be paid by [PLACEHOLDER: balance due date].</p>
<p><strong>Refunds:</strong> [PLACEHOLDER: refund terms for retreat payments other than the deposit]. If we cancel the retreat you will receive a full refund, including the deposit.</p>
<h2>Changes</h2><p>Speakers, sessions and timings may change. We will let you know about significant changes by email.</p>
<h2>Contact</h2><p><a href="mailto:info@thearimatheaacademy.com">info@thearimatheaacademy.com</a> · <a href="tel:+447412045045">07412 045045</a></p>
</main>'''
page('terms/index.html', 'Terms &amp; refunds | The Arimathea Academy', 'Booking terms and refund policy for The Arimathea Academy programmes and events.', terms)

notfound = hero('PAGE NOT FOUND', 'This page', 'has moved', 'Sorry, we could not find that page. Try one of these instead.') + '''
<main class="prose">
<ul>
<li><a href="/">Home</a></li>
<li><a href="/bootcamp/">Kingdom School of Business &amp; Ministry Bootcamp</a></li>
<li><a href="/retreat/">End of Year Retreat</a></li>
<li><a href="/programmes/">Programmes &amp; sessions</a></li>
</ul>
</main>'''
page('404.html', 'Page not found | The Arimathea Academy', 'Page not found.', notfound, noindex=True)
