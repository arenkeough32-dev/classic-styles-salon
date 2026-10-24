// Classic Styles "Ask us" AI — Cloudflare Worker. Holds the Anthropic key (as a secret), answers salon questions.
// Secrets/vars: ANTHROPIC_API_KEY (secret). Optional KV binding RL for rate limits.
const ORIGINS = ['https://classicstylesdayspas.com', 'https://www.classicstylesdayspas.com'];
const MODEL = 'claude-haiku-5-5';
const FACTS = `Classic Styles Salon & Day Spa — family-run hair salon and day spa, 4116 Grand Blvd, New Port Richey, FL 34652. Phone/text (727) 487-4475 (a real person answers; booking is by call or text only, no online booking).
Hours: Tue–Fri 9am–5pm, Sat 9am–3pm, closed Sun and Mon. Walk-ins welcome Tue–Sat; calling or texting ahead guarantees a chair. Parking on the side of the building.
35+ years on Grand Boulevard. Owner: Tammy ("Miss Tammy"), master stylist (cuts, color, perms, bridal). Stylists: Natalie (color correction, vivid color, bridal updos), Debbie, Jen, Aury (speaks Spanish), Kelly (manicures and pedicures).
Prices: haircuts from $25 (kids' cuts from $25), color/highlights/balayage from $60 with a free consultation; perms, treatments, nails, bridal and special occasion are quoted at a quick free consultation.
Services: cuts and styling, color, highlights, balayage, color correction, vivid color, classic perms/body waves/spiral perms (most last 3–6 months), deep conditioning and smoothing treatments, manicures and pedicures, bridal/wedding/quinceañera/prom updos, whole wedding parties (book a few weeks ahead; ask about on-location styling), gift certificates (call or text to buy, pick up at the desk).
Payment: major cards, Apple Pay, Google Pay, contactless, cash. Rating: 5.0 on Google (49 reviews).
Website pages: /weddings/, /gift-certificates/, /hair-color-balayage/, /haircuts-styling/, /perms/, /treatments/, /nail-salon/, /try-on/ (live color mirror), /questions/, /es/ (Spanish).`;
const SYSTEM = `You are the friendly front-desk assistant on the Classic Styles Salon website. Answer in 1–3 short sentences, warm and plain, in the visitor's language (English or Spanish).
Use ONLY these facts; if something isn't covered (exact price of a service quoted by consultation, availability, a specific stylist's schedule), say a stylist will confirm and suggest calling or texting (727) 487-4475. Never invent prices, times, discounts or policies. You cannot book appointments; always point to call or text for booking.
Stay on salon topics; politely decline anything else. No medical advice — for scalp or skin conditions suggest asking a stylist or a doctor.
FACTS:
${FACTS}`;

function cors(origin) {
  const ok = ORIGINS.includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : ORIGINS[0], 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
async function limited(env, ip) {
  if (!env.RL) return false;
  const day = new Date().toISOString().slice(0, 10);
  const kIp = `ip:${day}:${ip}`, kAll = `all:${day}`;
  const [a, b] = await Promise.all([env.RL.get(kIp), env.RL.get(kAll)]);
  const nIp = +(a || 0), nAll = +(b || 0);
  if (nIp >= 30 || nAll >= 600) return true; // per-visitor and whole-site daily caps (~$1/day ceiling at Haiku rates)
  await Promise.all([env.RL.put(kIp, String(nIp + 1), { expirationTtl: 90000 }), env.RL.put(kAll, String(nAll + 1), { expirationTtl: 90000 })]);
  return false;
}
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const h = cors(origin);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    if (req.method !== 'POST' || !ORIGINS.includes(origin)) return new Response('Not allowed', { status: 403, headers: h });
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (await limited(env, ip)) return Response.json({ reply: null, limited: true }, { headers: h });
    let body; try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: h }); }
    const msgs = (Array.isArray(body.messages) ? body.messages : []).slice(-8)
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 600) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return new Response('No question', { status: 400, headers: h });
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 220, system: SYSTEM, messages: msgs })
    });
    if (!r.ok) return Response.json({ reply: null }, { headers: h });
    const j = await r.json();
    const reply = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    return Response.json({ reply: reply || null }, { headers: h });
  }
};
