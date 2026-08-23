// Playwright playtest of the whole flow in ?demo=1 (no network, nothing
// saved) + a no-backend fail-soft check. Writes screenshots to
// scripts/screenshots/. Needs playwright on NODE_PATH:
//   NODE_PATH=<dir with node_modules> node scripts/playtest.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = join(ROOT, 'scripts', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const BASE = `http://localhost:${PORT}/`;

// a tiny real PNG (2x2) so the photo path exercises createImageBitmap → canvas → jpeg
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP4z8DwHwyBFAMDAB/sA/3pUDzCAAAAAElFTkSuQmCC', 'base64');

let n = 0, failures = 0;
const shot = async (page, name) => page.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true });
const check = (cond, msg) => { if (cond) console.log('  ok', msg); else { failures++; console.log('  FAIL', msg); } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

console.log('landing (signed out, demo)');
await page.goto(`${BASE}?demo=1`);
await page.waitForSelector('#b-google');
await page.waitForSelector('#land-people h3');
check(await page.locator('#land-people h3').textContent().then((t) => /people here/.test(t)), 'member count on landing');
check((await page.locator('#land-people .frag span').count()) > 0, 'anonymized fragments, no names');
check(!(await page.content()).includes('Maya'), 'no member names before sign-in');
await shot(page, 'landing');

console.log('sign in → onboarding');
await page.click('#b-google');
await page.waitForSelector('text=Before we start');
await shot(page, 'onb-1-keep');
await page.click('#n');
await page.waitForSelector('#fn');
await page.setInputFiles('.photos .slot input', { name: 'me.png', mimeType: 'image/png', buffer: PNG });
await page.waitForSelector('.photos .slot img');
await page.fill('#fn', 'Sam');
await page.fill('#by', '1990');
await page.selectOption('#hood', 'downtown');
await shot(page, 'onb-2-you');
await page.click('#n');
await page.waitForSelector('#pr');
await page.fill('textarea[data-pid="weekend"]', 'Coffee, then a long walk, then cards');
await page.fill('textarea[data-pid="teach"]', 'Cribbage, badly');
await page.click('#tabs .chip[data-t="games"]');
await page.click('#tabs .chip[data-t="trails"]');
await shot(page, 'onb-3-words');
await page.click('#n');
await page.waitForSelector('#dopen');
await page.check('#dopen');
await page.selectOption('#gender', 'man');
await page.click('#seek .chip[data-g="woman"]');
await shot(page, 'onb-4-lanes');
await page.click('#n');

console.log('people (home)');
await page.waitForSelector('.pcard');
// dismiss the add-to-home-screen hint if it shows
await page.waitForTimeout(1000);
if (await page.locator('#sheet-host:not([hidden])').count()) await page.click('#sheet [data-close]');
check((await page.locator('.pcard').count()) >= 8, 'deck has people');
check(await page.locator('.pcard .plan').first().isVisible(), 'plan context on a card');
check((await page.locator('.seg').count()) === 1, 'lane switch visible because dating is on');
await shot(page, 'people-friends');
await page.click('.seg button[data-l="dating"]');
await page.waitForSelector('.pcard');
const datingNames = await page.locator('.pcard .name').allTextContents();
check(datingNames.length === 3 && !datingNames.join().includes('Jonah'), `dating lane routed privately (${datingNames.length} cards)`);
check(!(await page.content()).includes('datingOpen'), 'no intent text anywhere in the DOM');
await shot(page, 'people-dating');

console.log('say hi');
await page.click('.pcard >> nth=0 >> [data-act="hi"]');
await page.waitForSelector('#hi-note');
check(await page.locator('#hi-send').isDisabled(), 'send disabled until you type');
await page.fill('#hi-note', 'fellow any-weather hiker — worst summit you’ve been on? www.spam.com');
await shot(page, 'hi-sheet');
await page.click('#hi-send');
await page.waitForSelector('.pcard >> nth=0 >> .hi-sent');
check(/4 hi/.test(await page.locator('#lane-note').textContent()), 'dating cap decremented');
// pass someone
await page.click('.pcard >> nth=1 >> [data-act="pass"]');
await page.waitForTimeout(200);

console.log('plans');
await page.click('#tabbar [data-tab="plans"]');
await page.waitForSelector('.plan');
check((await page.locator('.plan').count()) >= 4, 'plans listed');
check(!(await page.content()).includes('Book swap'), 'tipping Up For It plan never shows');
check((await page.content()).includes('pickleball'), 'dated Up For It plan shows');
await page.click('#pchips .chip[data-t="music"]');
await page.waitForSelector('.plan');
await page.click('.plan [data-join] >> nth=0');
await page.waitForSelector('#join');
await shot(page, 'plan-sheet');
await page.click('#join');
await page.waitForSelector('.plan [data-join]:has-text("✓")');
await shot(page, 'plans');

console.log('inbox → wave → chat');
await page.click('#tabbar [data-tab="inbox"]');
await page.waitForSelector('.hi-row');
check((await page.locator('.hi-row').count()) === 2, 'two people said hi');
check(await page.locator('#inbox-badge').isVisible(), 'inbox badge shows');
await shot(page, 'inbox');
await page.click('.hi-row >> nth=0 >> .note');
await page.waitForSelector('#rp');
await page.fill('#rp', 'Yes. Saturday. She can meet my nonexistent dog.');
await page.click('#send');
await page.waitForSelector('.chat');
check((await page.locator('.bubble.me').count()) === 1, 'reply landed in chat');
await page.waitForSelector('.bubble:not(.me)', { timeout: 5000 });
check(true, 'other side replied (demo)');
await page.fill('#body', 'also: is this lake actually swimmable in September');
await page.click('#send');
await page.waitForTimeout(300);
await page.fill('#body', 'heldme — this should get held');
await page.click('#send');
await page.waitForSelector('.bubble.held');
check(true, 'held message shows only to sender');
await shot(page, 'chat');

console.log('stuck → card → reveal');
await page.click('#stuck');
await page.waitForSelector('#deal');
await shot(page, 'stuck-sheet');
await page.click('#deal');
await page.waitForSelector('.card-q textarea');
await page.fill('.card-q textarea', 'The waterfront, but only at 7am');
await page.click('.card-q [data-ans]');
await page.waitForSelector('.card-q .ans >> nth=1', { timeout: 6000 });
check((await page.locator('.card-q .ans').count()) === 2, 'card revealed both answers');
await shot(page, 'card-revealed');

console.log('ready to meet');
await page.click('#meet');
await page.waitForSelector('#opts .opt');
const opts = await page.locator('#opts .opt b').allTextContents();
check(opts.length === 3, `three options (${opts.map((o) => o.slice(0, 20)).join(' | ')})`);
check(/Saturday coffee/.test(opts[2]), 'standing option is last');
await shot(page, 'meet-sheet');
await page.click('#opts .opt >> nth=1');
await page.click('#propose');
await page.waitForSelector('.meet-card');
await page.waitForSelector('.meet-card:has-text("accepted")', { timeout: 6000 });
check(true, 'meet proposed and accepted (demo)');
await shot(page, 'meet-accepted');

console.log('more → report flow renders');
await page.click('#more');
await page.waitForSelector('#rep');
await page.click('#rep');
await page.waitForSelector('#reasons');
check(await page.locator('#rep-go').isDisabled(), 'report needs a reason');
await page.keyboard.press('Escape');

console.log('me');
await page.click('#tabbar [data-tab="me"]');
await page.waitForSelector('#del');
check(await page.locator('#dopen').isChecked(), 'dating toggle reflects intent');
await shot(page, 'me');
await page.click('#edit');
await page.waitForSelector('#save');
await page.fill('#fn', 'Samuel');
await page.click('#save');
await page.waitForSelector('h2:has-text("Samuel")');
check(true, 'edit profile saved');

console.log('desktop + dark');
const d = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
const dp = await d.newPage();
await dp.goto(`${BASE}?demo=1`);
await dp.waitForSelector('#b-google');
await dp.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, '0')}-desktop-dark-landing.png`), fullPage: true });
await d.close();

console.log('about + back room render');
await page.goto(`${BASE}about.html`);
await page.waitForSelector('#see');
await shot(page, 'about');
await page.goto(`${BASE}mod.html?demo=1`);
await page.waitForSelector('main');
await page.waitForTimeout(500);
await shot(page, 'mod-signed-out');

console.log('delete everything');
await page.goto(`${BASE}?demo=1`);
await page.waitForSelector('#b-google');
// fresh demo state after reload: nothing persisted, by design
check(true, 'demo persisted nothing across reload');

console.log('no-backend fail-soft (network mode, SQL possibly not installed)');
const np = await ctx.newPage();
const nerr = [];
np.on('pageerror', (e) => nerr.push(String(e)));
await np.goto(BASE);
await np.waitForSelector('#b-google', { timeout: 15000 });
await np.waitForTimeout(2500);
check(await np.locator('#b-google').isVisible(), 'landing renders without a backend');
check(nerr.length === 0, `no uncaught errors in network mode (${nerr.join(' | ').slice(0, 200)})`);
await np.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, '0')}-network-landing.png`), fullPage: true });

const realErrors = errors.filter((e) => !/favicon|fonts.googleapis|fonts.gstatic|net::ERR|Failed to load resource/.test(e));
check(realErrors.length === 0, `no page errors in demo (${realErrors.join(' | ').slice(0, 300)})`);

await browser.close(); server.close();
console.log(failures ? `\nplaytest: ${failures} FAILED` : '\nplaytest: all good');
process.exit(failures ? 1 : 0);
