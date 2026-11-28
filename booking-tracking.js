(function () {
  var storageKey = 'kpb_ref';
  var ref = (new URLSearchParams(location.search).get('ref') || '').trim().slice(0, 60);

  // Keep the current URL usable even when the browser blocks session storage.
  try {
    if (ref) {
      sessionStorage.setItem(storageKey, ref);
    } else {
      ref = (sessionStorage.getItem(storageKey) || '').trim().slice(0, 60);
    }
  } catch (error) {
    // The referral can still pass through marked navigation links.
  }

  function track(name, params) {
    if (typeof window.gtag === 'function') {
      window.gtag('event', name, params);
    }
  }

  function carryRef(link) {
    if (!ref) return;
    var url = new URL(link.href);
    if (url.searchParams.has('ref')) return;
    url.searchParams.set('ref', ref);
    link.href = url.href;
  }

  document.querySelectorAll('a[data-keep-ref]').forEach(carryRef);

  var bookingPathnames = ['/r/vXr0r0', '/r/rDPE2X', '/r/kbEZKZ', '/r/NqoMbl'];
  document.querySelectorAll('a[href^="https://tally.so/r/vXr0r0"], a[href^="https://tally.so/r/rDPE2X"], a[href^="https://tally.so/r/kbEZKZ"], a[href^="https://tally.so/r/NqoMbl"]').forEach(function (link) {
    var bookingUrl = new URL(link.href);
    if (bookingUrl.origin !== 'https://tally.so' || bookingPathnames.indexOf(bookingUrl.pathname) === -1) return;
    carryRef(link);
    link.addEventListener('click', function () {
      track('booking_click', {
        ref_code: ref || 'direct',
        link_text: link.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
        link_url: link.href,
        transport_type: 'beacon'
      });
    });
  });

  if (ref) track('referral_visit', { ref_code: ref });
})();
