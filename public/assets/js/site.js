/*
 * Every page: compact menu button for the header on smaller screens.
 * The button toggles the nav (and the header CTA) open and closed.
 * Which screen widths get the button is set in site.css (.js-nav rules).
 * Without JavaScript the full nav stays visible.
 */
(function () {
  var header = document.querySelector('.site-header');
  var button = header && header.querySelector('.nav-toggle');
  if (!button) return;

  header.classList.add('js-nav');

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  button.addEventListener('click', function () {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  // Close after choosing a link (matters for #anchors on the same page).
  header.addEventListener('click', function (e) {
    if (e.target.closest('.nav a, .header-cta')) setOpen(false);
  });

  // Escape closes the menu and returns focus to the button.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && header.classList.contains('nav-open')) {
      setOpen(false);
      button.focus();
    }
  });
})();
