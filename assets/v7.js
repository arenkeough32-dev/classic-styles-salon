/* Classic Styles v7: team galleries (accessible lightbox), desktop-only cinematic video, Aury's line. */
(function(){
  /* ---- Aury's phone: ONE value to change. Leave '' to keep using the salon line (727) 487-4475.
     When Aury has a direct number, put it here as digits with country code, e.g. '+17275551234'. ---- */
  var AURY_PHONE = '';
  var AURY_DISPLAY = ''; // e.g. '(727) 555-1234'

  if (AURY_PHONE) {
    document.querySelectorAll('[data-aury]').forEach(function(a){
      var kind = a.getAttribute('data-aury');
      if (kind === 'tel') a.href = 'tel:' + AURY_PHONE;
      if (kind === 'sms') a.href = 'sms:' + AURY_PHONE + (a.href.indexOf('?') > -1 ? a.href.slice(a.href.indexOf('?')) : '');
      if (kind === 'label' && AURY_DISPLAY) a.textContent = AURY_DISPLAY;
    });
  }

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conn = navigator.connection;
  var bigScreen = window.matchMedia('(min-width: 861px)').matches;

  /* ---- Desktop-only ambient video: never on phones, save-data or reduced motion ---- */
  var vids = document.querySelectorAll('video[data-desktop-src]');
  if (vids.length && bigScreen && !reduce && !(conn && conn.saveData) && 'IntersectionObserver' in window) {
    var vo = new IntersectionObserver(function(es){
      es.forEach(function(e){
        var v = e.target;
        if (e.isIntersecting) {
          if (!v.getAttribute('src')) { v.src = v.getAttribute('data-desktop-src'); v.addEventListener('playing', function(){ v.classList.add('on'); }, { once: true }); }
          var p = v.play(); if (p && p.catch) p.catch(function(){});
        } else if (v.getAttribute('src')) { v.pause(); }
      });
    }, { rootMargin: '200px 0px', threshold: 0.1 });
    vids.forEach(function(v){ vo.observe(v); });
  }

  /* ---- Desktop reel arrows ---- */
  var reel = document.querySelector('.reel');
  if (reel && reel.parentNode) {
    var ESr = (document.documentElement.lang || '').indexOf('es') === 0;
    var ctl = document.createElement('div'); ctl.className = 'wrap reel-ctl';
    ctl.innerHTML = '<button type="button" aria-label="' + (ESr ? 'Fotos anteriores' : 'Previous photos') + '">&#8592;</button><button type="button" aria-label="' + (ESr ? 'Más fotos' : 'More photos') + '">&#8594;</button>';
    reel.parentNode.parentNode.insertBefore(ctl, reel.parentNode.nextSibling);
    var bs = ctl.querySelectorAll('button');
    bs[0].onclick = function(){ reel.scrollBy({ left: -reel.clientWidth * 0.7, behavior: reduce ? 'auto' : 'smooth' }); };
    bs[1].onclick = function(){ reel.scrollBy({ left: reel.clientWidth * 0.7, behavior: reduce ? 'auto' : 'smooth' }); };
  }

  /* ---- Team galleries ---- */
  var dataEl = document.getElementById('team-work');
  if (!dataEl) return;
  var G; try { G = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (AURY_PHONE && G.aury) G.aury.book = 'tel:' + AURY_PHONE;
  var ES = (document.documentElement.lang || '').indexOf('es') === 0;
  var L = ES ? { close: 'Cerrar', prev: 'Foto anterior', next: 'Foto siguiente', of: 'de', work: 'Trabajo de', book: 'Reservar con ' }
             : { close: 'Close', prev: 'Previous photo', next: 'Next photo', of: 'of', work: 'Work by', book: 'Book with ' };

  var lb = document.createElement('div');
  lb.className = 'lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-labelledby', 'lb-title');
  lb.innerHTML = '<div class="lb-top"><p class="lb-title" id="lb-title"></p><button type="button" class="lb-x" aria-label="' + L.close + '">&times;</button></div>'
    + '<div class="lb-stage"><figure><img alt="" decoding="async"><figcaption></figcaption></figure>'
    + '<button type="button" class="lb-nav lb-prev" aria-label="' + L.prev + '">&#8249;</button><button type="button" class="lb-nav lb-next" aria-label="' + L.next + '">&#8250;</button></div>'
    + '<div class="lb-foot"><span class="lb-n" aria-live="polite"></span><a class="btn btn-solid btn-sm lb-book" href="#"></a></div>';
  document.body.appendChild(lb);
  var img = lb.querySelector('img'), cap = lb.querySelector('figcaption'), title = lb.querySelector('.lb-title'),
      num = lb.querySelector('.lb-n'), book = lb.querySelector('.lb-book'), prev = lb.querySelector('.lb-prev'), next = lb.querySelector('.lb-next');
  var cur = null, idx = 0, opener = null;

  function show(i){
    var items = G[cur].items; idx = (i + items.length) % items.length; var it = items[idx];
    img.src = it.src; if (it.srcset) img.srcset = it.srcset; else img.removeAttribute('srcset');
    img.sizes = '(max-width: 860px) 100vw, 70vw'; img.alt = it.alt; cap.textContent = it.cap || '';
    num.textContent = items.length > 1 ? (idx + 1) + ' ' + L.of + ' ' + items.length : '';
    prev.hidden = next.hidden = items.length < 2;
    var n = items[(idx + 1) % items.length]; if (n && items.length > 1) { var pre = new Image(); pre.src = n.src; }
  }
  function open(key, from){
    if (!G[key]) return; cur = key; opener = from || document.activeElement;
    var g = G[key];
    title.innerHTML = ''; title.appendChild(document.createTextNode(L.work + ' ' + g.name));
    if (g.role) { var s = document.createElement('small'); s.textContent = g.role; title.appendChild(s); }
    book.textContent = (g.bookLabel || (L.book + g.name)); book.href = g.book || 'tel:+17274874475';
    lb.classList.add('open'); document.documentElement.classList.add('lb-lock');
    show(0); lb.querySelector('.lb-x').focus();
  }
  function close(){
    lb.classList.remove('open'); document.documentElement.classList.remove('lb-lock');
    img.removeAttribute('src'); if (opener && opener.focus) opener.focus();
  }
  lb.querySelector('.lb-x').addEventListener('click', close);
  prev.addEventListener('click', function(){ show(idx - 1); });
  next.addEventListener('click', function(){ show(idx + 1); });
  lb.addEventListener('click', function(e){ if (e.target === lb || e.target.classList.contains('lb-stage')) close(); });
  document.addEventListener('keydown', function(e){
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') show(idx + 1);
    else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'Tab') { // focus trap
      var f = Array.prototype.filter.call(lb.querySelectorAll('button,a[href]'), function(el){ return !el.hidden && el.offsetParent !== null; });
      if (!f.length) return; var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // swipe
  var sx = null, sy = null, stage = lb.querySelector('.lb-stage');
  stage.addEventListener('touchstart', function(e){ var t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  stage.addEventListener('touchend', function(e){
    if (sx === null) return; var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) show(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  document.querySelectorAll('[data-gallery]').forEach(function(b){
    b.addEventListener('click', function(e){ e.preventDefault(); open(b.getAttribute('data-gallery'), b); });
  });
})();
