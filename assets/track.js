/* Cookie-free visit + tap counter (GoatCounter). Counts page views and taps on Call / Text / Directions.
   No cookies, no personal data. Does nothing until GC_CODE is set. */
(function(){
  var GC_CODE = ''; // e.g. 'classicstyles' -> https://classicstyles.goatcounter.com
  if (!GC_CODE || location.hostname.indexOf('classicstylesdayspas.com') < 0) return;
  var s = document.createElement('script');
  s.async = true; s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://' + GC_CODE + '.goatcounter.com/count');
  document.head.appendChild(s);
  function kind(a){
    var h = a.getAttribute('href') || '';
    if (h.indexOf('tel:') === 0) return 'tap-call';
    if (h.indexOf('sms:') === 0) return 'tap-text';
    if (/google\.[a-z.]+\/maps|maps\.app\.goo|g\.page|goo\.gl\/maps/.test(h) && h.indexOf('/review') < 0) return 'tap-directions';
    if (h.indexOf('/review') > -1) return 'tap-review';
    if (h.indexOf('/try-on/') === 0) return 'tap-try-on';
    return null;
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a'); if (!a) return;
    var k = kind(a); if (!k || !window.goatcounter || !window.goatcounter.count) return;
    window.goatcounter.count({ path: k + (location.pathname.indexOf('/es/') === 0 ? '-es' : ''), title: k, event: true });
  }, true);
})();
