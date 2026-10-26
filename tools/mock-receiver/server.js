// Fake downstream system: receives signed jobs and lets you send status callbacks back.
// Open http://localhost:4001 to see received jobs and click status buttons.
//   PORT=4001  SECRET=dev-integration-secret  AUTO=1 (auto-progress ACCEPTED -> IN_PROGRESS -> DONE)
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 4001);
const SECRET = process.env.SECRET || 'dev-integration-secret';
const AUTO = process.env.AUTO === '1';
const FAIL = process.env.FAIL === '1'; // respond 500 to test retries

const jobs = [];

const sign = (body) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const verify = (body, sig) => {
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig || '');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

async function callback(entry, status, note) {
  const body = JSON.stringify({ jobId: entry.job.id, status, externalRef: entry.ref, note });
  const res = await fetch(entry.callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': sign(body) },
    body,
  });
  const text = await res.text();
  entry.log.push(`${new Date().toLocaleTimeString()} → ${status}: HTTP ${res.status} ${text.slice(0, 120)}`);
  console.log(`callback ${entry.job.number} ${status} -> ${res.status}`);
}

const escape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page() {
  const rows = jobs
    .map(
      (e, i) => `<tr><td><b>${escape(e.job.number)}</b><br><small>${escape(e.ref)}</small></td>
      <td>${escape(e.job.title)}<pre>${escape(JSON.stringify(e.job.data, null, 1))}</pre></td>
      <td>${escape(e.customer.displayName)}<br>${escape(e.customer.phone)}</td>
      <td>${['ACCEPTED', 'IN_PROGRESS', 'DONE', 'REJECTED']
        .map((s) => `<form method="post" action="/ui/${i}/${s}"><button>${s}</button></form>`)
        .join('')}</td>
      <td><small>${e.log.map(escape).join('<br>')}</small></td></tr>`,
    )
    .reverse()
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Mock Receiver</title><meta http-equiv="refresh" content="5">
  <style>body{font-family:system-ui;margin:24px}table{border-collapse:collapse;width:100%}td{border:1px solid #ddd;padding:8px;vertical-align:top}
  pre{margin:4px 0;font-size:12px;white-space:pre-wrap}form{display:inline}button{margin:2px}</style>
  <h2>Mock Receiver <small>(secret: ${SECRET.slice(0, 4)}…, auto: ${AUTO}, fail: ${FAIL})</small></h2>
  <table><tr><th>Job</th><th>Detail</th><th>Customer</th><th>Send status</th><th>Log</th></tr>${rows || '<tr><td colspan=5>No jobs yet</td></tr>'}</table>`;
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        if (req.method === 'GET' && req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(page());
        }
        if (req.method === 'GET' && req.url === '/received') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(jobs.map((e) => ({ ...e.job, ref: e.ref, log: e.log }))));
        }
        const ui = req.url.match(/^\/ui\/(\d+)\/(\w+)$/);
        if (req.method === 'POST' && ui) {
          await callback(jobs[Number(ui[1])], ui[2], 'อัปเดตจาก Mock Receiver');
          res.writeHead(303, { Location: '/' });
          return res.end();
        }
        if (req.method === 'POST' && req.url === '/jobs') {
          if (!verify(body, req.headers['x-signature'])) {
            res.writeHead(401);
            return res.end('bad signature');
          }
          const msg = JSON.parse(body);
          if (msg.event === 'ping') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ pong: true }));
          }
          if (FAIL) {
            res.writeHead(500);
            return res.end('simulated failure');
          }
          let entry = jobs.find((e) => e.job.id === msg.job.id); // Idempotency-Key = job id
          if (!entry) {
            entry = { job: msg.job, customer: msg.customer, callbackUrl: msg.callbackUrl, ref: `EXT-${1000 + jobs.length}`, log: [] };
            jobs.push(entry);
            console.log(`received ${msg.job.number}: ${msg.job.title}`);
            if (AUTO) {
              setTimeout(() => callback(entry, 'ACCEPTED', 'รับเรื่องแล้ว'), 3000);
              setTimeout(() => callback(entry, 'IN_PROGRESS', 'ช่างกำลังเดินทาง'), 8000);
              setTimeout(() => callback(entry, 'DONE', 'ซ่อมเสร็จแล้ว'), 15000);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ externalRef: entry.ref }));
        }
        res.writeHead(404);
        res.end();
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
  })
  .listen(PORT, () => console.log(`Mock receiver on http://localhost:${PORT} (POST /jobs)`));
