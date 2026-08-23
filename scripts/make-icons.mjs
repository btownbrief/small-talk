// Renders icon.svg to PNGs with Playwright (no native image tools needed).
// Run: NODE_PATH=<dir with playwright> node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = readFileSync(new URL('../icon.svg', import.meta.url), 'utf8');
const b = await chromium.launch(); const p = await b.newPage();
mkdirSync(new URL('../assets/icons/', import.meta.url), { recursive: true });
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:#2E7D8A">${svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `)}</body></html>`);
  const buf = await p.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
  writeFileSync(new URL(`../assets/icons/${name}`, import.meta.url), buf);
  void pad;
}
await b.close(); console.log('icons written');
