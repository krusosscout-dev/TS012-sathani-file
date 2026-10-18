// สถานีไฟล์ — teacher registration (once per device, before using the tools).
// Uses the same Upstash for Redis database as api/stats.js.
// GET  -> { open: true } when registration is ready (the page shows the form only then)
// POST -> saves one registration: name, position, school, area, optional note, consent
// No email, phone or IP address is stored. Repeated sending from one network is slowed down.
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const P = 'sf:';
const PER_HOUR = 20;   // registrations allowed per network per hour

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function netKey(req) {   // a one-way fingerprint of the network, never the address itself
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  return crypto.createHash('sha256').update(ip + '|' + TOKEN).digest('hex').slice(0, 16);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ open: false, error: 'not_configured' });
  if (req.method === 'GET') return res.status(200).json({ open: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const rec = {
    name: clean(body.name, 100),
    position: clean(body.position, 60),
    school: clean(body.school, 150),
    area: clean(body.area, 100),
    note: clean(body.note, 1000)
  };
  const missing = [];
  if (rec.name.length < 2) missing.push('name');
  if (!rec.position) missing.push('position');
  if (rec.school.length < 2) missing.push('school');
  if (rec.area.length < 2) missing.push('area');
  if (missing.length) return res.status(400).json({ error: 'missing', fields: missing });
  if (body.consent !== true) return res.status(400).json({ error: 'consent_required' });

  try {
    const hour = new Date().toISOString().slice(0, 13);
    const rl = P + 'rl:reg:' + netKey(req) + ':' + hour;
    const [count] = await redis([['INCR', rl], ['EXPIRE', rl, '3600']]);
    if (count > PER_HOUR) return res.status(429).json({ error: 'too_many' });

    rec.id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    rec.at = new Date().toISOString();
    const d = today();
    await redis([
      ['LPUSH', P + 'regs', JSON.stringify(rec)],
      ['INCR', P + 'regcount'],
      ['INCR', P + 'regs:' + d], ['EXPIRE', P + 'regs:' + d, String(3 * 24 * 3600)]
    ]);
    return res.status(200).json({ ok: true, id: rec.id });
  } catch (e) {
    return res.status(502).json({ error: 'unavailable' });
  }
};
