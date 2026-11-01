/*
 * Programmes page: option pickers.
 * - Clarity Session: 60 mins / 90 mins changes price, label and booking link.
 * - Addiction to Freedom: Foundation / Restoration changes the whole card.
 * Edit prices, links and copy in OPTIONS below.
 * Keep the first option of each group in sync with the HTML that ships
 * pre-rendered (so the page reads correctly before/without JavaScript).
 */
(function () {
  var OPTIONS = {
    clarity: {
      '60': {
        label: '60 mins', cta: '60 MINS', price: '£100',
        href: 'https://www.coachli.co/thearimatheaacademy/session/the-clarity-session?id=13417'
      },
      '90': {
        label: '90 mins', cta: '90 MINS', price: '£150',
        href: 'https://www.coachli.co/thearimatheaacademy/session/90mins-clarity-session?id=13418'
      }
    },
    recovery: {
      foundation: {
        label: 'Foundation', cta: 'FOUNDATION', price: '£200', term: '4-week delivery',
        desc: 'A self-paced recovery experience for the person who is ready to begin privately, at their own pace and on their own terms.',
        href: 'https://www.coachli.co/thearimatheaacademy/PS-G8Ug1',
        includes: [
          'Full pre-recorded Addiction to Freedom programme',
          'The 5R and 5S Recovery Frameworks',
          'Recovery worksheets and guided reflection exercises',
          'Habit and structure templates',
          'One session with the mentor',
          'Private community access and lifetime programme access'
        ]
      },
      restoration: {
        label: 'Restoration', cta: 'RESTORATION', price: '£2,500', term: '4-month delivery',
        desc: 'Everything in Foundation, and more. For long-standing cycles that need accountability, personal guidance and someone to walk with you through the process.',
        href: 'https://www.coachli.co/thearimatheaacademy/PS-jbLca',
        includes: [
          'All Foundation materials and community access',
          'Three private mentoring and support sessions',
          'Personalised recovery guidance and implementation support',
          'Accountability check-ins and progress reviews',
          'Priority community access'
        ]
      }
    }
  };

  function select(group, value) {
    var opt = OPTIONS[group][value];
    if (!opt) return;

    document.querySelectorAll('[data-group="' + group + '"]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.dataset.value === value ? 'true' : 'false');
    });

    document.querySelectorAll('[data-' + group + ']').forEach(function (el) {
      var key = el.getAttribute('data-' + group);
      if (key === 'href') {
        el.setAttribute('href', opt.href);
      } else if (key === 'includes') {
        var tpl = el.querySelector('li');
        if (!tpl) return;
        var fresh = opt.includes.map(function (text) {
          var li = tpl.cloneNode(true);
          li.querySelector('span').textContent = text;
          return li;
        });
        el.replaceChildren.apply(el, fresh);
      } else if (opt[key] !== undefined) {
        el.textContent = opt[key];
      }
    });
  }

  document.querySelectorAll('button[data-group]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      select(btn.dataset.group, btn.dataset.value);
    });
  });
})();
