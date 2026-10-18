// สถานีไฟล์ — owner's page: list and delete registrations.
// The password is the ADMIN_PASSWORD environment variable set in Vercel (never in this file).
// POST { password, action: 'list' }            -> { items: [...], total }
// POST { password, action: 'delete', id }      -> { ok: true }   (for PDPA deletion requests)
// After 10 wrong passwords from one network, it waits 15 minutes before trying again.
const crypto = require('crypto');
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN = process.env.ADMIN_PASSWORD || '';
const P = 'sf:';
const MAX_FAILS = 10;

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map(x => x.result);
}
function netKey(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  return crypto.createHash('sha256').update(ip + '|' + TOKEN).digest('hex').slice(0, 16);
}
function samePassword(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'not_configured' });
  if (!ADMIN) return res.status(503).json({ error: 'admin_not_configured' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  try {
    const failKey = P + 'adminfail:' + netKey(req);
    const [fails] = await redis([['GET', failKey]]);
    if ((+fails || 0) >= MAX_FAILS) return res.status(429).json({ error: 'too_many' });
    if (!samePassword(body.password || '', ADMIN)) {
      await redis([['INCR', failKey], ['EXPIRE', failKey, '900']]);
      return res.status(401).json({ error: 'wrong_password' });
    }

    const [raw] = await redis([['LRANGE', P + 'regs', '0', '-1']]);
    const list = (raw || []).map(s => { try { return { s, r: JSON.parse(s) }; } catch (e) { return null; } }).filter(Boolean);

    if (body.action === 'delete') {
      const hit = list.find(x => x.r.id === String(body.id || ''));
      if (!hit) return res.status(404).json({ error: 'not_found' });
      const [removed, left] = await redis([['LREM', P + 'regs', '1', hit.s], ['DECR', P + 'regcount']]);
      if (left < 0) await redis([['SET', P + 'regcount', '0']]);
      return res.status(200).json({ ok: removed > 0 });
    }
    return res.status(200).json({ items: list.map(x => x.r), total: list.length });
  } catch (e) {
    return res.status(502).json({ error: 'unavailable' });
  }
};
