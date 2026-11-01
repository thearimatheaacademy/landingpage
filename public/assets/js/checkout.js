/*
 * Shared helpers for the 2-step forms (/register/ and /retreat/book/).
 * Step 1 posts the details to the Worker; step 2 shows Stripe's Embedded Checkout on the page.
 * Prices are never sent from here: the Worker works them out.
 */
(function () {
  function api(path, options) {
    return fetch('/api' + path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Something went wrong. Please try again.');
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Stripe) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('The secure payment form could not load. Please check your connection and try again.')); };
      document.head.appendChild(s);
    });
  }

  var stripePromise = null;
  function getStripe() {
    if (!stripePromise) {
      stripePromise = Promise.all([api('/config'), loadScript('https://js.stripe.com/v3/')]).then(function (out) {
        var key = out[0].stripeKey;
        if (!key || /REPLACE/.test(key)) throw new Error('Online payment is not switched on yet. Please call or WhatsApp us on 07412 045045 to book.');
        return window.Stripe(key);
      });
      stripePromise.catch(function () { stripePromise = null; }); // allow a retry
    }
    return stripePromise;
  }

  var current = null;
  function mount(clientSecret, el) {
    unmount();
    el.innerHTML = '<p class="loading">Loading secure payment form…</p>';
    return getStripe()
      .then(function (stripe) { return stripe.initEmbeddedCheckout({ fetchClientSecret: function () { return Promise.resolve(clientSecret); } }); })
      .then(function (checkout) { el.innerHTML = ''; current = checkout; checkout.mount(el); })
      .catch(function (e) { el.innerHTML = ''; throw e; });
  }
  function unmount() {
    if (current) { current.destroy(); current = null; }
  }

  function gbp(pence) {
    var n = pence / 100;
    return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function showError(el, message) {
    el.textContent = message;
    el.classList.add('show');
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function clearError(el) { el.textContent = ''; el.classList.remove('show'); }

  // Shows step `n` (sections marked data-step="n") and updates the step indicator.
  function setStep(n) {
    document.querySelectorAll('[data-step]').forEach(function (s) { s.hidden = Number(s.dataset.step) !== n; });
    document.querySelectorAll('.steps li').forEach(function (li, i) {
      if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.classList.toggle('done', i + 1 < n);
    });
    var heading = document.querySelector('[data-step="' + n + '"] h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: document.querySelector('.checkout').offsetTop - 12, behavior: 'auto' });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.Checkout = { api: api, post: post, mount: mount, unmount: unmount, gbp: gbp, showError: showError, clearError: clearError, setStep: setStep, escapeHtml: escapeHtml };
})();
