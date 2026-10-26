#!/usr/bin/env node
// Expose the local app through a Cloudflare quick tunnel (random https://*.trycloudflare.com,
// no account needed) and write that URL to PUBLIC_BASE_URL in web/.env.
//   npm run tunnel
// Env: PORT=3000  CLOUDFLARED=<path to cloudflared; default: cloudflared on PATH>
// The URL changes on every run: restart `npm run dev` and update the LINE Webhook URL afterwards.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const port = process.env.PORT || 3000;
const bin = process.env.CLOUDFLARED || 'cloudflared';
const envFile = path.join(__dirname, '..', 'web', '.env');

function writeBaseUrl(url) {
  if (!fs.existsSync(envFile)) {
    console.warn(`! ${envFile} not found — copy web/.env.example to web/.env, then set PUBLIC_BASE_URL=${url}`);
    return false;
  }
  const text = fs.readFileSync(envFile, 'utf8');
  const line = `PUBLIC_BASE_URL=${url}`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const next = /^PUBLIC_BASE_URL=.*$/m.test(text)
    ? text.replace(/^PUBLIC_BASE_URL=.*$/m, line)
    : `${text}${text === '' || text.endsWith('\n') ? '' : eol}${line}${eol}`;
  fs.writeFileSync(envFile, next);
  return true;
}

const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
  stdio: ['ignore', 'inherit', 'pipe'],
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`cloudflared not found ("${bin}"). Install it with: winget install --id Cloudflare.cloudflared`);
    console.error('or set CLOUDFLARED=<path to cloudflared.exe>');
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

let url;
// cloudflared logs to stderr; show only errors, and pick the public URL out of the banner.
readline.createInterface({ input: child.stderr }).on('line', (text) => {
  if (/\bERR\b/.test(text)) console.error(text);
  const found = !url && text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!found) return;
  url = found[0];
  const saved = writeBaseUrl(url);
  console.log(`
> Tunnel ready: ${url} -> http://localhost:${port}
  ${saved ? `PUBLIC_BASE_URL updated in web/.env` : 'PUBLIC_BASE_URL not saved (see above)'}
  Legacy webhook:  ${url}/webhooks/line
  Per-OA webhooks: see the "บัญชี LINE OA" admin page (${url}/webhooks/line/<id>)

  Next: start or restart \`npm run dev\`, then paste the new Webhook URL in the LINE Developers Console
        (and update Auth0 callback/logout URLs if you use Auth0). Ctrl+C stops the tunnel.
`);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 0 : 1)));
