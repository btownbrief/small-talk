// Builds data/plans.json from the Btown Brief events feed. Runs nightly in
// CI (.github/workflows/refresh-plans.yml) and by hand:
//   node scripts/build-plans.mjs            (fetches the live feed)
//   node scripts/build-plans.mjs path.json  (uses a local events.json)
//
// What qualifies as a "plan" here: a dated, real, public event in the next
// ~14 days that a couple of people could reasonably show up to together —
// so: mapped to one of the four tabs, or in a joinable category (games,
// music, outdoors, sports, words, food-drink, community, wellness, market,
// learning), in Chittenden County, not all-day, not kid/family programming.
// Plans travel as a place and a time; nothing about people rides along.

import { writeFileSync, readFileSync } from 'node:fs';
import { tabForEvent } from '../js/core.js';

const FEED = 'https://guide.btownbrief.com/data/events/events.json';
const OUT = new URL('../data/plans.json', import.meta.url);
const DAYS = 14;
const JOINABLE = new Set(['games', 'music', 'outdoors', 'sports', 'words', 'food-drink', 'community', 'wellness', 'market', 'learning', 'comedy', 'film', 'art']);
const TOWNS = new Set(['burlington', 'south burlington', 'winooski', 'essex', 'essex junction', 'williston', 'colchester', 'shelburne', 'charlotte', 'milton', 'richmond', 'jericho', 'hinesburg', 'huntington', 'bolton', 'st. george', 'underhill', 'westford']);
const SKIP = /\b(kids?|children|toddler|storytime|family|teen|youth|preschool|summer camp|ages? \d+-\d+)\b/i;
const STANDING = {
  id: 'standing:saturday-coffee', title: 'Saturday coffee (the usual crowd)', place: 'Downtown — spot posted on Meetup', neighborhood: 'Downtown',
  tab: null, cap: null, going: 0, host: 'Stephen', url: 'https://www.meetup.com/burlington-social-activites-group/', source: 'standing', status: 'dated',
};

function nextSaturday10(now) { const d = new Date(now); d.setHours(10, 0, 0, 0); while (d.getDay() !== 6 || d.getTime() < now) d.setDate(d.getDate() + 1); return d.toISOString(); }

function toPlan(ev) {
  if (!ev.start || ev.allDay) return null;
  if (ev.status && ev.status !== 'active') return null;
  if (SKIP.test(`${ev.title} ${ev.description ?? ''}`)) return null;
  if (ev.age && /\b(kids|children|under 1\d|family)\b/i.test(ev.age)) return null;
  const town = String(ev.town ?? '').toLowerCase();
  if (town && !TOWNS.has(town)) return null;
  const tab = tabForEvent(ev);
  if (!tab && !JOINABLE.has(ev.category)) return null;
  return {
    id: `ev:${ev.id}`,
    title: String(ev.title).slice(0, 80),
    place: String(ev.venue || ev.town || 'Burlington').slice(0, 60),
    neighborhood: ev.town && ev.town !== 'Burlington' ? ev.town : null,
    startsAt: ev.start, endsAt: ev.end ?? null,
    tab, cap: null, going: 0, host: null,
    url: ev.url ?? null, source: 'events', status: 'dated',
    price: ev.free ? 'Free' : (ev.price ? String(ev.price).slice(0, 40) : null),
  };
}

const now = Date.now();
let feed;
if (process.argv[2]) feed = JSON.parse(readFileSync(process.argv[2], 'utf8'));
else { const r = await fetch(FEED); if (!r.ok) throw new Error(`feed ${r.status}`); feed = await r.json(); }
const t0 = now - 3600e3, t1 = now + DAYS * 86400e3;
const seen = new Set();
const plans = (feed.events || []).map(toPlan).filter(Boolean)
  .filter((p) => { const t = Date.parse(p.startsAt); return t >= t0 && t <= t1; })
  .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
  .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
plans.push({ ...STANDING, startsAt: nextSaturday10(now) });
writeFileSync(OUT, JSON.stringify({ generated: new Date(now).toISOString(), source: FEED, count: plans.length, plans }, null, 1));
const byTab = {}; for (const p of plans) byTab[p.tab ?? 'none'] = (byTab[p.tab ?? 'none'] || 0) + 1;
console.log(`plans.json: ${plans.length} plans in the next ${DAYS} days`, byTab);
