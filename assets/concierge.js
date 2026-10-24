/* "Ask us" concierge — answers common questions instantly, hands every booking to a real person by call or text.
   No AI service, no cookies, no data leaves the page. */
(function(){
  var ES = (document.documentElement.lang || '').indexOf('es') === 0;
  var AI_ENDPOINT = ''; // set to the Cloudflare Worker URL to switch on AI answers
  var hist = [];
  var TEL = 'tel:+17274874475';
  var SMS = 'sms:+17274874475?&body=' + encodeURIComponent(ES ? 'Hola Classic Styles! Quisiera hacer una cita.' : "Hi Classic Styles! I'd like to book an appointment.");
  var T = ES ? {
    open:'Pregúntenos', title:'Classic Styles', sub:'Respuestas al instante. Para reservar, una persona real le contesta.',
    hi:'¡Hola! ¿En qué le puedo ayudar? Elija una pregunta o escríbala.', ph:'Escriba su pregunta…', send:'Enviar',
    call:'Llamar', text:'Enviar texto', close:'Cerrar',
    fallback:'Buena pregunta. La forma más rápida de saberlo es preguntarle a un estilista: llame o envíe un texto al (727) 487-4475.'
  } : {
    open:'Ask us', title:'Classic Styles', sub:'Instant answers. For booking, a real person replies.',
    hi:'Hi! What can I help with? Tap a question or type your own.', ph:'Type a question…', send:'Send',
    call:'Call', text:'Text us', close:'Close',
    fallback:"Good question. The quickest way to get an exact answer is to ask a stylist: call or text (727) 487-4475."
  };
  var KB = ES ? [
    [/hora|abre|cierra|domingo|lunes|s[aá]bado/i,'Martes a viernes de 9:00 am a 5:00 pm, y sábado de 9:00 am a 3:00 pm. Domingo y lunes cerrado.','¿Horario?'],
    [/precio|cu[aá]nto|cuesta|corte/i,'Los cortes empiezan en $25 y el color en $60. Los demás servicios se cotizan en una consulta rápida y gratis.','¿Precios?'],
    [/sin cita|walk|llegar/i,'Sí, aceptamos clientes sin cita de martes a sábado. Para asegurar su silla, llame o envíe un texto antes.','¿Sin cita?'],
    [/estacion|parqu|parking/i,'Estacionamiento al costado del salón, en 4116 Grand Blvd, con entrada por enfrente o por atrás (Edificio 1).','¿Estacionamiento?'],
    [/pag|tarjeta|efectivo|apple|google pay/i,'Aceptamos tarjetas, Apple Pay, Google Pay, pago sin contacto y efectivo.','¿Formas de pago?'],
    [/espa[nñ]ol|aury/i,'¡Claro! Aury habla español. Pida por ella al llamar.','¿Hablan español?'],
    [/donde|direcci|ubica/i,'4116 Grand Blvd, New Port Richey, FL 34652.','¿Dónde están?']
  ] : [
    [/hour|open|close|sunday|monday|saturday|today/i,'Tuesday to Friday 9 am to 5 pm, and Saturday 9 am to 3 pm. Closed Sunday and Monday.','Hours?'],
    [/balayage|color|colour|highlight|gray|grey|blonde/i,'Color, highlights and balayage start at $60, and every color service starts with a free consult. You can preview a shade on yourself with our live color mirror.','Color & balayage?'],
    [/price|cost|how much|\$|cheap|haircut|trim/i,'Haircuts start at $25 and color starts at $60. Everything else is quoted in a quick free consultation, so the price you hear is the price you pay.','Prices?'],
    [/walk|appointment|same day|today/i,'Yes, walk-ins are welcome Tuesday to Saturday. Call or text ahead to guarantee your chair.','Walk-ins?'],
    [/book|schedule|reserve/i,'Booking is by call or text, and a real person answers. Most appointments are confirmed in under a minute.','How do I book?'],
    [/park/i,'Parking is on the side of the building at 4116 Grand Blvd, and you can come in the front or back door (Building 1).','Parking?'],
    [/pay|card|cash|apple|google pay|venmo/i,'All major cards, Apple Pay, Google Pay, contactless and cash.','Payment?'],
    [/perm|curl|wave/i,'Yes, we still do classic perms, body waves and spiral curls; it is a specialty after 35 years. Most perms last 3 to 6 months.','Perms?'],
    [/nail|mani|pedi|gel/i,'Kelly does manicures and pedicures. Call or text to book with her.','Nails?'],
    [/bride|bridal|wedding|prom|updo|event/i,'We do bridal and special-occasion updos, and whole wedding parties are welcome. Book groups a few weeks ahead.','Weddings?'],
    [/kid|child|toddler|son|daughter/i,'Kids are very welcome: patient stylists, first haircuts and kids’ cuts from $25.','Kids?'],
    [/spanish|espa|aury/i,'Yes, Aury speaks Spanish. Ask for her when you call.','Spanish?'],
    [/where|address|direction|locat/i,'4116 Grand Blvd, New Port Richey, FL 34652, with parking on the side of the building.','Where are you?']
  ];
  var style = document.createElement('style');
  style.textContent = '.cq-btn{position:fixed;right:1.1rem;bottom:1.1rem;z-index:80;display:flex;align-items:center;gap:.5rem;padding:.8rem 1.15rem;border:0;border-radius:999px;background:var(--ink,#231B16);color:var(--paper,#FAF7F2);font:500 .98rem/1 var(--sans,system-ui);box-shadow:0 10px 30px rgba(35,27,22,.28);cursor:pointer}'
   +'.cq-btn:hover{background:var(--copper,#9C5B2E)}.cq-dot{width:.55rem;height:.55rem;border-radius:50%;background:#7BC08A}'
   +'@media(max-width:980px){.cq-btn{bottom:calc(4.4rem + env(safe-area-inset-bottom,0));right:.8rem;padding:.7rem 1rem}}'
   +'.cq{position:fixed;right:1.1rem;bottom:1.1rem;z-index:90;width:min(23rem,calc(100vw - 1.6rem));max-height:min(36rem,calc(100vh - 2rem));display:none;flex-direction:column;background:var(--paper,#FAF7F2);border-radius:18px 18px 4px 4px;box-shadow:0 30px 80px rgba(35,27,22,.35);overflow:hidden}'
   +'@media(max-width:980px){.cq{right:.8rem;bottom:calc(4.4rem + env(safe-area-inset-bottom,0));max-height:calc(100vh - 6.5rem)}}'
   +'.cq.open{display:flex}.cq-hd{background:var(--ink,#231B16);color:var(--paper,#FAF7F2);padding:1rem 1.1rem;display:flex;justify-content:space-between;gap:1rem}'
   +'.cq-hd b{font:500 1.2rem/1.1 var(--serif,Georgia)}.cq-hd small{display:block;opacity:.75;font-size:.82rem;margin-top:.25rem}'
   +'.cq-x{background:none;border:0;color:inherit;font-size:1.5rem;line-height:1;cursor:pointer}'
   +'.cq-log{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.6rem}'
   +'.cq-m{max-width:88%;padding:.65rem .85rem;border-radius:14px;font-size:.95rem;line-height:1.45}'
   +'.cq-m.b{background:var(--mist,#E7DFD4);align-self:flex-start;border-bottom-left-radius:4px}.cq-m.u{background:var(--ink,#231B16);color:var(--paper,#FAF7F2);align-self:flex-end;border-bottom-right-radius:4px}'
   +'.cq-chips{display:flex;flex-wrap:wrap;gap:.4rem;padding:0 1rem .6rem}.cq-chips button{border:1px solid rgba(35,27,22,.25);background:transparent;border-radius:999px;padding:.4rem .75rem;font:400 .85rem/1 var(--sans,system-ui);cursor:pointer}'
   +'.cq-chips button:hover{border-color:var(--copper,#9C5B2E);color:var(--copper,#9C5B2E)}'
   +'.cq-act{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;padding:.6rem 1rem}.cq-act a{display:flex;justify-content:center;align-items:center;min-height:2.6rem;border:1px solid var(--ink,#231B16);border-radius:2px;text-decoration:none;font:500 .92rem/1 var(--sans,system-ui);color:var(--ink,#231B16)}.cq-act a+a{background:var(--ink,#231B16);color:var(--paper,#FAF7F2)}'
   +'.cq-f{display:flex;border-top:1px solid rgba(35,27,22,.12)}.cq-f input{flex:1;border:0;padding:.95rem 1rem;font:400 1rem/1 var(--sans,system-ui);background:transparent;min-width:0}.cq-f input:focus{outline:none}.cq-f button{border:0;background:none;padding:0 1rem;color:var(--copper,#9C5B2E);font:500 .95rem/1 var(--sans,system-ui);cursor:pointer}';
  document.head.appendChild(style);
  var btn = document.createElement('button'); btn.className = 'cq-btn'; btn.type = 'button';
  btn.setAttribute('aria-haspopup', 'dialog'); btn.innerHTML = '<span class="cq-dot" aria-hidden="true"></span>' + T.open;
  var box = document.createElement('div'); box.className = 'cq'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', T.open);
  box.innerHTML = '<div class="cq-hd"><div><b>' + T.title + '</b><small>' + T.sub + '</small></div><button class="cq-x" type="button" aria-label="' + T.close + '">&times;</button></div>'
    + '<div class="cq-log" aria-live="polite"></div><div class="cq-chips"></div>'
    + '<div class="cq-act"><a href="' + TEL + '">' + T.call + '</a><a href="' + SMS + '">' + T.text + '</a></div>'
    + '<form class="cq-f"><label class="sr-only" for="cq-in">' + T.ph + '</label><input id="cq-in" autocomplete="off" placeholder="' + T.ph + '"><button type="submit">' + T.send + '</button></form>';
  document.body.appendChild(btn); document.body.appendChild(box);
  var log = box.querySelector('.cq-log'), chips = box.querySelector('.cq-chips'), input = box.querySelector('input');
  function say(text, who){ var m = document.createElement('div'); m.className = 'cq-m ' + who; m.textContent = text; log.appendChild(m); log.scrollTop = log.scrollHeight; }
  function answer(q){
    say(q, 'u'); hist.push({ role: 'user', content: q });
    var done = function(a){ hist.push({ role: 'assistant', content: a }); say(a, 'b'); };
    for (var i = 0; i < KB.length; i++) if (KB[i][0].test(q) && (!AI_ENDPOINT || q.length < 60)) { setTimeout(function(a){ return function(){ done(a); }; }(KB[i][1]), 250); return; }
    if (!AI_ENDPOINT || !window.fetch) { setTimeout(function(){ done(T.fallback); }, 250); return; }
    var dots = document.createElement('div'); dots.className = 'cq-m b'; dots.textContent = '…'; log.appendChild(dots); log.scrollTop = log.scrollHeight;
    var ctl = window.AbortController ? new AbortController() : null; var to = setTimeout(function(){ if (ctl) ctl.abort(); }, 12000);
    fetch(AI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: hist.slice(-8) }), signal: ctl ? ctl.signal : undefined })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ clearTimeout(to); dots.remove(); done(j && j.reply ? j.reply : T.fallback); })
      .catch(function(){ clearTimeout(to); dots.remove(); done(T.fallback); });
  }
  KB.slice(0, 6).forEach(function(k){ var c = document.createElement('button'); c.type = 'button'; c.textContent = k[2]; c.onclick = function(){ answer(k[2]); }; chips.appendChild(c); });
  var greeted = false;
  function open(){ box.classList.add('open'); btn.style.display = 'none'; if (!greeted) { say(T.hi, 'b'); greeted = true; } input.focus({preventScroll:true}); }
  function close(){ box.classList.remove('open'); btn.style.display = ''; btn.focus(); }
  btn.onclick = open; box.querySelector('.cq-x').onclick = close;
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && box.classList.contains('open')) close(); });
  box.querySelector('form').onsubmit = function(e){ e.preventDefault(); var v = input.value.trim(); if (v) { answer(v); input.value = ''; } };
})();
