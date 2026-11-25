"""ONE-OFF (already run, 25 Nov 2026): wrote public/books/ and public/books/thank-you/. public/ is the source of truth; edit those files directly."""
import re
from pathlib import Path

import sys
if '--force' not in sys.argv:
    sys.exit('Refusing to run: public/ is the source of truth.')
PUB = Path(__file__).resolve().parent.parent / 'public'
reg = (PUB / 'register' / 'index.html').read_text()
lines = reg.split('\n')
head_header = '\n'.join(lines[:43])          # up to and including </header>
footer = '\n'.join(lines[194:202])            # <footer ...> ... </footer> and closing </div>


def page_head(title, desc, noindex=False):
    h = head_header
    h = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', h)
    h = re.sub(r'(<meta (?:name="description"|property="og:description") content=")[^"]*"', lambda m: m.group(1) + desc + '"', h)
    h = re.sub(r'(<meta property="og:title" content=")[^"]*"', lambda m: m.group(1) + title + '"', h)
    h = h.replace('<a href="/programmes/" aria-current="page">PROGRAMMES</a>', '<a href="/programmes/">PROGRAMMES</a>')
    h = h.replace('<a href="/#books">BOOKS</a>', '<a href="/#books" aria-current="page">BOOKS</a>')
    h = h.replace('<a class="cta-gold header-cta" href="/register/">REGISTER NOW</a>', '<a class="cta-gold header-cta" href="/books/">BUY THE BOOK</a>')
    if noindex:
        h = h.replace('</head>', '<meta name="robots" content="noindex">\n</head>')
    assert 'aria-current="page">BOOKS' in h, 'nav not updated'
    return h


LOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E9D08A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>'

shop = page_head('Buy Running on Bended Knees | The Arimathea Academy',
                 'Order a paperback copy of Running on Bended Knees by Collins Imadojemu. £15 including UK delivery. Limited copies.') + '''

<section class="gold page-hero" style="position: relative; overflow: hidden">
<div style="position: absolute; right: 0; bottom: 0; width: 0; height: 0; border-left: 150px solid transparent; border-bottom: 96px solid #B8862E" aria-hidden="true"></div>
<div class="inner" style="position: relative">
<div class="eyebrow">BOOKS · BY COLLINS IMADOJEMU</div>
<h1 class="page-title">Running on <span>Bended Knees</span></h1>
<p class="lede">How to Build Your Altar and Stay Consistent in the Secret Place. Paperback, £15 including delivery to a UK address.</p>
<p class="lede" id="stock-line" style="margin-top: 8px; font-weight: 600; color: #23571F"></p>
<ol class="steps" aria-label="Progress"><li aria-current="step">Delivery details</li><li>Payment</li></ol>
</div>
</section>

<div class="checkout">
<div class="checkout-main">

<section id="sold-out" hidden>
<div class="panel">
<h2 class="panel-title">Sold out<small>All copies have been sold for now.</small></h2>
<p style="margin: 0">Thank you for your interest. Please email <a href="mailto:info@thearimatheaacademy.com">info@thearimatheaacademy.com</a> or call <a href="tel:+447412045045">07412 045045</a> and we will let you know when more copies are available.</p>
</div>
</section>

<section data-step="1" aria-labelledby="s1-title">
<form id="details" novalidate>
<div class="panel">
<h2 class="panel-title" id="s1-title">Your details<small>We send your order confirmation to this email address.</small></h2>
<div class="form-error" id="err1" role="alert"></div>
<div class="form-grid">
<div class="field"><label for="first_name">First name</label><input id="first_name" name="first_name" autocomplete="given-name" required maxlength="60"></div>
<div class="field"><label for="last_name">Last name</label><input id="last_name" name="last_name" autocomplete="family-name" required maxlength="60"></div>
</div>
<div class="form-grid">
<div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
<div class="field"><label for="phone">Phone <span class="opt-label">(optional, for delivery)</span></label><input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="40"></div>
</div>
</div>

<div class="panel">
<h2 class="panel-title">Delivery address<small>We post to UK addresses only.</small></h2>
<div class="field"><label for="address_line1">Address line 1</label><input id="address_line1" name="address_line1" autocomplete="address-line1" required maxlength="120"></div>
<div class="field"><label for="address_line2">Address line 2 <span class="opt-label">(optional)</span></label><input id="address_line2" name="address_line2" autocomplete="address-line2" maxlength="120"></div>
<div class="form-grid">
<div class="field"><label for="city">Town or city</label><input id="city" name="city" autocomplete="address-level2" required maxlength="80"></div>
<div class="field"><label for="postcode">Postcode</label><input id="postcode" name="postcode" autocomplete="postal-code" required maxlength="8" style="text-transform: uppercase"></div>
</div>
<div class="field"><label for="country">Country</label><input id="country" value="United Kingdom" disabled></div>
</div>

<div class="panel">
<h2 class="panel-title">Your order</h2>
<div class="field" style="max-width: 220px"><label for="quantity">Number of copies</label><select id="quantity" name="quantity"><option value="1">1 copy</option></select></div>
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="check"><input type="checkbox" name="accept_terms" required> <span>I agree to the <a href="/terms/" target="_blank" rel="noopener">terms &amp; refund policy</a> and <a href="/privacy/" target="_blank" rel="noopener">privacy policy</a>.</span></label>
<label class="check"><input type="checkbox" name="marketing_consent"> <span>Keep me updated about future Arimathea Academy books, programmes and events.</span></label>
<button class="btn-primary" id="go" type="submit">Continue to payment</button>
<p class="note">Nothing is charged until you confirm on the next step. Your copies are held for you for 30 minutes while you pay.</p>
</div>
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
<div class="summary-label" id="sum-label">YOUR ORDER</div>
<div style="display: flex; gap: 16px; align-items: flex-start; margin-top: 12px">
<img src="/assets/img/book-running-on-bended-knees.jpg" alt="Running on Bended Knees by Collins Imadojemu, book cover" style="width: 84px; aspect-ratio: 2 / 3; object-fit: cover; flex: 0 0 auto; box-shadow: 0 8px 20px rgba(0,0,0,0.35)">
<h2 style="margin: 0">Running on Bended Knees</h2>
</div>
<dl id="sum-lines"></dl>
<ul class="facts">
<li><strong>Format:</strong> Paperback</li>
<li><strong>Delivery:</strong> Included, UK addresses only</li>
</ul>
<div class="secure">''' + LOCK + '''<span>We email you when your order is posted.</span></div>
</div>
</aside>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
  var C = window.Checkout, form = document.getElementById('details'), err1 = document.getElementById('err1'), err2 = document.getElementById('err2');
  var go = document.getElementById('go'), box = document.getElementById('checkout'), qty = document.getElementById('quantity');
  var PRICE = 1500, saved = null;

  function summary(q, total, ref) {
    document.getElementById('sum-lines').innerHTML = '<dt>' + q + ' × ' + C.gbp(PRICE) + '</dt><dd>' + C.gbp(PRICE * q) + '</dd><dt>UK delivery</dt><dd>Included</dd>'
      + '<div class="rule" role="presentation"></div><div class="due" style="display: contents"><dt>Total</dt><dd>' + C.gbp(total == null ? PRICE * q : total) + '</dd></div>';
    if (ref) document.getElementById('sum-label').textContent = 'ORDER ' + ref;
  }
  function soldOut() {
    document.getElementById('sold-out').hidden = false;
    document.querySelectorAll('[data-step]').forEach(function (s) { s.hidden = true; });
    document.querySelector('.steps').hidden = true;
    document.getElementById('stock-line').textContent = 'Sold out';
  }
  function setStock(info) {
    PRICE = info.price || PRICE;
    if (!info.available) return soldOut();
    var keep = Number(qty.value) || 1;
    qty.innerHTML = '';
    for (var i = 1; i <= info.max_per_order; i++) qty.insertAdjacentHTML('beforeend', '<option value="' + i + '">' + i + (i === 1 ? ' copy' : ' copies') + '</option>');
    qty.value = String(Math.min(keep, info.max_per_order));
    document.getElementById('stock-line').textContent = info.available <= 10 ? 'Limited stock: ' + info.available + (info.available === 1 ? ' copy' : ' copies') + ' left.' : '';
    summary(Number(qty.value));
  }
  qty.addEventListener('change', function () { summary(Number(qty.value)); });
  summary(1);
  C.api('/book').then(setStock).catch(function () {});

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    C.clearError(err1);
    form.querySelectorAll('[aria-invalid]').forEach(function (el) { el.removeAttribute('aria-invalid'); });
    function bad(id, msg) { document.getElementById(id).setAttribute('aria-invalid', 'true'); C.showError(err1, msg); }
    var d = Object.fromEntries(new FormData(form));
    if (!d.first_name.trim()) return bad('first_name', 'Please enter your first name.');
    if (!d.last_name.trim()) return bad('last_name', 'Please enter your last name.');
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(d.email.trim())) return bad('email', 'Please enter a valid email address.');
    if (!d.address_line1.trim()) return bad('address_line1', 'Please enter your street address.');
    if (!d.city.trim()) return bad('city', 'Please enter your town or city.');
    if (!/^[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2}$/i.test(d.postcode.trim())) return bad('postcode', 'Please enter a valid UK postcode. We can only post to UK addresses.');
    if (!d.accept_terms) return C.showError(err1, 'Please accept the terms to continue.');
    var body = {
      first_name: d.first_name, last_name: d.last_name, email: d.email, phone: d.phone, address_line1: d.address_line1, address_line2: d.address_line2,
      city: d.city, postcode: d.postcode, quantity: Number(d.quantity), accept_terms: true, marketing_consent: !!d.marketing_consent, website: d.website,
    };
    if (saved) { body.order_id = saved.id; body.token = saved.token; }
    go.disabled = true; go.textContent = 'Please wait…';
    C.post('/book/order', body).then(function (out) {
      saved = { id: out.order.id, token: out.order.token };
      summary(out.order.quantity, out.order.total, out.order.reference);
      document.getElementById('paying-as').innerHTML = 'Posting to <strong>' + C.escapeHtml(out.order.first_name + ' ' + out.order.last_name) + '</strong>, ' + C.escapeHtml(out.order.address.join(', '));
      C.setStep(2);
      return C.mount(out.client_secret, box).catch(function (x) { C.showError(err2, x.message); });
    }).catch(function (x) {
      if (x.data && x.data.sold_out) return soldOut();
      if (x.data && x.data.available) C.api('/book').then(setStock).catch(function () {});
      C.showError(err1, x.message);
    }).finally(function () { go.disabled = false; go.textContent = 'Continue to payment'; });
  });

  document.getElementById('edit').addEventListener('click', function () { C.unmount(); C.clearError(err2); C.setStep(1); });
});
</script>

''' + footer + '''
<script src="/assets/js/site.js" defer></script>
<script src="/assets/js/checkout.js" defer></script>
</body>
</html>
'''
(PUB / 'books').mkdir(exist_ok=True)
(PUB / 'books' / 'index.html').write_text(shop)

thanks = page_head('Order received | Running on Bended Knees', 'Thank you for your order.', noindex=True) + '''

<section class="gold page-hero" style="position: relative; overflow: hidden">
<div style="position: absolute; right: 0; bottom: 0; width: 0; height: 0; border-left: 150px solid transparent; border-bottom: 96px solid #B8862E" aria-hidden="true"></div>
<div class="inner" style="position: relative">
<div class="eyebrow">RUNNING ON BENDED KNEES</div>
<h1 class="page-title">Thank <span>you</span></h1>
<p class="lede">Your order has been received.</p>
</div>
</section>
<main class="prose">
<p id="msg">We have emailed your order confirmation, and we will email you again when your book has been posted. If you cannot see the email within a few minutes, please check your spam or promotions folder.</p>
<p>Questions? Reply to your confirmation email, or call or WhatsApp us on <a href="tel:+447412045045">07412 045045</a>.</p>
<p style="margin-top: 32px"><a class="cta" href="/" style="display: inline-flex; align-items: center; min-height: 54px; padding: 0 30px; background: #23571F; color: #FBF5E3; text-decoration: none; font-family: 'Oswald', sans-serif; font-weight: 500; letter-spacing: 0.16em; font-size: 15px">BACK TO THE HOME PAGE</a></p>
</main>
<script>
(function () {
  var q = new URLSearchParams(location.search), ref = (q.get('ref') || '').replace(/[^A-Z0-9-]/gi, '');
  if (q.get('processing')) {
    document.querySelector('.page-title').innerHTML = 'Payment <span>processing</span>';
    document.querySelector('.lede').textContent = 'Your payment is still being confirmed by your bank.';
    document.getElementById('msg').textContent = 'We will email you as soon as it goes through. There is no need to pay again.';
  } else if (ref) {
    document.querySelector('.lede').textContent = 'Your order ' + ref + ' has been received.';
  }
})();
</script>

''' + footer + '''
<script src="/assets/js/site.js" defer></script>
</body>
</html>
'''
(PUB / 'books' / 'thank-you').mkdir(exist_ok=True)
(PUB / 'books' / 'thank-you' / 'index.html').write_text(thanks)
print('written')
