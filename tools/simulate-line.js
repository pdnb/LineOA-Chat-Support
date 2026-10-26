#!/usr/bin/env node
// Send fake LINE webhook events to the local API (no LINE account needed).
//   node tools/simulate-line.js text "สวัสดี"
//   node tools/simulate-line.js postback "action=cat&code=repair"
//   node tools/simulate-line.js follow
// Env: API=http://localhost:3000  USER_ID=Udemo0001  LINE_CHANNEL_SECRET=<signs the body if set>
//      CHANNEL=<LINE OA id from the admin page; omitted = the default OA via the legacy URL>
const crypto = require('crypto');

const [kind = 'text', value = 'สวัสดี'] = process.argv.slice(2);
const api = process.env.API || 'http://localhost:3000';
const userId = process.env.USER_ID || 'Udemo0001';

const base = { replyToken: `sim-${Date.now()}`, source: { type: 'user', userId }, timestamp: Date.now(), mode: 'active' };
const event =
  kind === 'postback'
    ? { ...base, type: 'postback', postback: { data: value } }
    : kind === 'follow'
      ? { ...base, type: 'follow' }
      : { ...base, type: 'message', message: { id: `sim${Date.now()}`, type: 'text', text: value } };

const body = JSON.stringify({ destination: 'Usimulator', events: [event] });
const headers = { 'Content-Type': 'application/json' };
if (process.env.LINE_CHANNEL_SECRET) {
  headers['x-line-signature'] = crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(body).digest('base64');
}

const path = process.env.CHANNEL ? `/webhooks/line/${process.env.CHANNEL}` : '/webhooks/line';

fetch(`${api}${path}`, { method: 'POST', headers, body })
  .then(async (res) => console.log(`HTTP ${res.status} ${await res.text()}`))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
