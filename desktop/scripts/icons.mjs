// Runs after `tauri icon` (see `npm run icons -w desktop`, needed after changing web/src/app/icon.svg):
// drops the mobile/macOS icons this Windows-only app never ships, then renders the PNGs the app embeds:
// taskbar overlay badges (1..9, 9+), the tray icon with an unread dot, and the setup page logo.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'src-tauri', 'icons');
const appIcon = readFileSync(join(root, '..', 'web', 'src', 'app', 'icon.svg'), 'utf8');

for (const name of readdirSync(icons)) {
  if (['android', 'ios', 'icon.icns', '64x64.png', 'StoreLogo.png'].includes(name) || name.startsWith('Square')) {
    rmSync(join(icons, name), { recursive: true });
  }
}

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } })
    .render()
    .asPng();
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log('wrote', path);
}

// Overlay icons are drawn at 16px by Windows; render at 32 so they stay crisp on high-DPI screens.
for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']) {
  const fontSize = label.length > 1 ? 15 : 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="#e11d48" stroke="#fff" stroke-width="2"/>
    <text x="16" y="16" dy="0.36em" text-anchor="middle" font-family="Segoe UI" font-weight="700"
      font-size="${fontSize}" fill="#fff">${label}</text>
  </svg>`;
  write(join(icons, 'badge', `${label === '9+' ? '9plus' : label}.png`), png(svg, 32));
}

// Tray icon with unread dot: the app icon plus a red dot in the top-right corner.
const inner = appIcon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const trayUnread = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${inner}
  <circle cx="25" cy="7" r="6.5" fill="#e11d48" stroke="#fff" stroke-width="1.5"/>
</svg>`;
write(join(icons, 'tray-unread.png'), png(trayUnread, 64));

write(join(root, 'src', 'icon.png'), png(appIcon, 64));
