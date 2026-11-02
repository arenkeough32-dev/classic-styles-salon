/* Classic Styles v6 — homepage scroll story. Needs gsap, ScrollTrigger, SplitText (and optionally Lenis) loaded first. */
(function(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var desktop = window.matchMedia('(min-width: 861px)').matches;

  // Reduced motion or missing libraries: show the calm, static version.
  if (reduce || !window.gsap || !window.ScrollTrigger) {
    document.querySelectorAll('.walk-cap,.walk-end').forEach(function(el){ el.style.opacity = 1; });
    
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);
  document.documentElement.classList.add('story-ready');
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(run);
  function run(){

  // 1. Smooth, weighted scrolling (desktop only; phones keep native scroll)
  if (window.Lenis && desktop) {
    var lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function(t){ lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    document.querySelectorAll('a[href^="#"],a[href^="/#"]').forEach(function(a){
      a.addEventListener('click', function(e){
        var id = a.getAttribute('href').replace(/^\//,''); var el = id.length > 1 && document.querySelector(id);
        if (el && location.pathname === '/') { e.preventDefault(); lenis.scrollTo(el, { offset: -70 }); }
      });
    });
  }

  // 3. Walk in the front door: pinned scene. Four real photos of the salon push forward and
  //    cross-fade as you scroll (a "walkthrough"), using only transform/opacity so phones stay smooth.
  var walk = document.querySelector('.walk');
  if (walk) {
    var shots = walk.querySelectorAll('.walk-frame .ws');
    // warm the later photos as the visitor gets close, so the fades never show a blank frame
    ScrollTrigger.create({ trigger: walk, start: 'top 180%', once: true, onEnter: function(){ shots.forEach(function(im){ im.loading = 'eager'; if (im.decode) im.decode().catch(function(){}); }); } });
    var tl = gsap.timeline({ scrollTrigger: { trigger: walk, start: 'top top', end: desktop ? '+=260%' : '+=200%', pin: true, scrub: 0.6, anticipatePin: 1 } });
    tl.fromTo('.walk-frame', { scale: desktop ? 0.62 : 0.8 }, { scale: desktop ? 1.08 : 1.02, ease: 'none', duration: 10 }, 0);
    // [start, end] of each photo's time on screen; each one "walks" forward, the next fades in over it
    var spans = [[0, 3.6], [2.8, 6.2], [5.4, 8.4], [7.6, 10]];
    shots.forEach(function(im, i){
      var s = spans[i] || spans[spans.length - 1];
      tl.fromTo(im, { scale: 1, xPercent: i % 2 ? 2 : -2 }, { scale: 1.22, xPercent: i % 2 ? -2 : 2, ease: 'none', duration: s[1] - s[0] }, s[0]);
      if (i > 0) tl.fromTo(im, { opacity: 0 }, { opacity: 1, ease: 'none', duration: 0.8 }, s[0]);
    });
    tl.to('.walk-cap.c1', { opacity: 1, y: -10, duration: 1 }, 0.6).to('.walk-cap.c1', { opacity: 0, duration: 1 }, 3.2)
      .to('.walk-cap.c2', { opacity: 1, y: -10, duration: 1 }, 3.6).to('.walk-cap.c2', { opacity: 0, duration: 1 }, 6.2)
      .to('.walk-cap.c3', { opacity: 1, y: -10, duration: 1 }, 6.6)
      .to('.walk-end', { opacity: 1, duration: 1 }, 8.2);
  }

  // 4. Horizontal reel of real work (desktop): vertical scroll slides the gallery sideways
  var reel = document.querySelector('.reel');
  if (reel && desktop) {
    // desktop: native horizontal scroll; arrow buttons are added by v7.js
  } else if (reel) { // phones: 3D ring while swiping
    var upd = function(){ var c = reel.scrollLeft + reel.clientWidth / 2;
      reel.querySelectorAll('figure').forEach(function(f){ var m = f.offsetLeft + f.offsetWidth / 2, d = Math.max(-1, Math.min(1, (m - c) / f.offsetWidth));
        f.style.transform = 'rotateY(' + (-d * 34).toFixed(1) + 'deg) translateZ(' + (-Math.abs(d) * 80).toFixed(0) + 'px) scale(' + (1 - Math.abs(d) * .08).toFixed(3) + ')'; }); };
    reel.addEventListener('scroll', function(){ requestAnimationFrame(upd); }, { passive: true }); upd();
  }

  // 5-7. Headline, quote and number reveals now live in v7.css (scroll-driven CSS, screenshot-safe).

  window.addEventListener('load', function(){ ScrollTrigger.refresh(); });
  }
})();
/* wedding stack: each card sinks back as the next one slides over it */
(function(){
  var cards = document.querySelectorAll('.wcard');
  cards.forEach(function(c, i){ c.style.setProperty('--i', i); });
  if (!window.gsap || !window.ScrollTrigger || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cards.forEach(function(c, i){
    var next = cards[i + 1]; if (!next) return;
    gsap.to(c.querySelector('figure'), { scale: 0.9, filter: 'brightness(.55)', ease: 'none',
      scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 20%', scrub: true } });
  });
})();
