// สถานีไฟล์ — usage counter shown on the home page.
// Needs the free "Upstash for Redis" database connected to this Vercel project
// (Vercel → Storage / Marketplace → Upstash for Redis → Connect). Until then it answers 503
// and the home page simply hides the numbers. Only counts are stored: no files, names or personal data.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const P = 'sf:';
const TOOLS = ['org', 'pdf2img', 'img'];
const KEEP_DAYS = 3 * 24 * 3600;   // daily counters expire after 3 days

function today() {   // date in Thailand, e.g. 2026-10-18
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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(503).json({ error: 'not_configured' });
  const d = today();
  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};
      if (body.type === 'visit') {
        await redis([['INCR', P + 'visits'], ['INCR', P + 'visits:' + d], ['EXPIRE', P + 'visits:' + d, String(KEEP_DAYS)]]);
      } else if (body.type === 'files') {
        const n = Math.min(500, Math.max(1, parseInt(body.n, 10) || 1));
        const tool = TOOLS.includes(body.tool) ? body.tool : 'org';
        await redis([['INCRBY', P + 'files', String(n)], ['INCRBY', P + 'files:' + tool, String(n)],
                     ['INCRBY', P + 'files:' + d, String(n)], ['EXPIRE', P + 'files:' + d, String(KEEP_DAYS)]]);
      } else {
        return res.status(400).json({ error: 'bad_type' });
      }
    } else if (req.method !== 'GET') {
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    const [v, vt, f, ft, fo, fp, fi, rg] = await redis([
      ['GET', P + 'visits'], ['GET', P + 'visits:' + d], ['GET', P + 'files'], ['GET', P + 'files:' + d],
      ['GET', P + 'files:org'], ['GET', P + 'files:pdf2img'], ['GET', P + 'files:img'], ['GET', P + 'regcount']
    ]);
    return res.status(200).json({
      date: d, visits: +v || 0, today: +vt || 0, files: +f || 0, filesToday: +ft || 0, registered: Math.max(0, +rg || 0),
      byTool: { org: +fo || 0, pdf2img: +fp || 0, img: +fi || 0 }
    });
  } catch (e) {
    return res.status(502).json({ error: 'unavailable' });
  }
};
