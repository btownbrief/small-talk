// SMALL TALK — pure core. No DOM, no fetch, no Date.now(): time is an argument.
// Every rule here is mirrored one-for-one by supabase/small-talk-SETUP.sql and
// by js/fake-backend.js. Change all three together and add a test case.
//
// Vocabulary (see README): a PROFILE is public to signed-in members; an
// INTENT is private and only routes what you see; a HI is one required line
// (≤140) to one person; a WAVE is a one-tap reply; a CHAT opens on reply or
// wave; a CARD is a question both answer privately and reveal together; a
// PLAN is a place and a time from the plans feed; a MEET is a proposal to
// go somewhere (or to a plan together); AFTER is the private one-tap check-in.

export const APP_NAME = 'Small Talk';
export const APP_PATH = '/small-talk/';

// Neighborhoods are a pick-list on purpose: no GPS, no addresses, ever.
export const NEIGHBORHOODS = [
  { id: 'downtown', label: 'Downtown' },
  { id: 'one', label: 'Old North End' },
  { id: 'south-end', label: 'South End' },
  { id: 'hill', label: 'Hill Section / UVM' },
  { id: 'new-north-end', label: 'New North End' },
  { id: 'winooski', label: 'Winooski' },
  { id: 'south-burlington', label: 'South Burlington' },
  { id: 'essex', label: 'Essex / Williston' },
  { id: 'shelburne', label: 'Shelburne / Charlotte' },
  { id: 'colchester', label: 'Colchester / Milton' },
  { id: 'elsewhere', label: 'Elsewhere in Chittenden' },
];

// A tab exists only if it implies a recurring, nameable plan in Burlington.
// They're the only browse filter and the plan categories.
export const TABS = [
  { id: 'dogs', label: 'Dogs', emoji: '🐕', plan: 'a waterfront dog walk' },
  { id: 'trails', label: 'Trails', emoji: '⛰', plan: 'a hike, ski, or paddle' },
  { id: 'music', label: 'Live music', emoji: '🎶', plan: 'a show' },
  { id: 'games', label: 'Games', emoji: '🃏', plan: 'cards or board games' },
];
export const TAB_IDS = TABS.map((t) => t.id);

// Two prompts, in your own words. Short, answerable, no therapy ambushes.
export const PROMPTS = [
  { id: 'weekend', q: 'A good Saturday here looks like…' },
  { id: 'send', q: "The place I'd send a visitor that isn't on any list…" },
  { id: 'lately', q: "Something I've been into lately…" },
  { id: 'order', q: 'My order, and whether it ever changes…' },
  { id: 'weather', q: "The weather I'll still go out in…" },
  { id: 'teach', q: 'A thing I could teach you in ten minutes…' },
  { id: 'argue', q: "A Burlington opinion I'll defend…" },
  { id: 'next', q: "Next on my list to try around here…" },
];
export const PROMPT_IDS = PROMPTS.map((p) => p.id);

export const GENDERS = ['woman', 'man', 'nonbinary'];

export const LIMITS = Object.freeze({
  nameMin: 1, nameMax: 24,
  promptMax: 140,
  hiMax: 140,
  messageMax: 1000,
  cardAnswerMax: 280,
  photosMax: 3,
  tabsMax: 4,
  promptsRequired: 2,
  hiExpiryDays: 7,
  datingHiPerWeek: 5,        // the gender-balance lever; invisible, gender-neutral
  reportsToSuppress: 2,      // suppress from browse pending review, never delete
  meetPlaces: 3,
  minAge: 18,
  browsePage: 24,
});

export const RATE = Object.freeze({
  hisPerDay: 20,             // any lane; the dating-lane weekly cap is separate
  hiPeoplePerWeek: 15,       // distinct recipients per rolling week, both lanes — the friends lane is not a spray lane
  messagesPerHour: 120,
  reportsPerDay: 10,
});

// ---------------------------------------------------------------- helpers

const URLISH = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|app|me|co|ly|gg|tv)\b(\/\S*)?/gi;
/** Collapse whitespace and strip URL-ish tokens from public text. Mirrors st_clean. */
export function clean(text, max) {
  let s = String(text ?? '').replace(URLISH, '').replace(/\s+/g, ' ').trim();
  if (max) s = s.slice(0, max);
  return s;
}

export const isHex = (s, n = 32) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(s);
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Age from birth year at a given time. Birth year only — we never store a DOB. */
export function ageAt(birthYear, now) {
  const y = new Date(now).getUTCFullYear();
  return y - Number(birthYear);
}
export function validBirthYear(birthYear, now) {
  const y = Number(birthYear);
  if (!Number.isInteger(y)) return false;
  const age = ageAt(y, now);
  return age >= LIMITS.minAge && age <= 110;
}

// ---------------------------------------------------------------- profile

/**
 * Validate + normalize a profile draft. Returns { ok, profile } or { ok:false, errors }.
 * Photos are validated separately (storage); here we only check count.
 */
export function validateProfile(draft, now) {
  const errors = {};
  const firstName = clean(draft.firstName, LIMITS.nameMax);
  if (firstName.length < LIMITS.nameMin) errors.firstName = 'First name, please.';
  if (!validBirthYear(draft.birthYear, now)) errors.birthYear = `You must be ${LIMITS.minAge}+.`;
  const hood = NEIGHBORHOODS.find((n) => n.id === draft.neighborhood)?.id;
  if (!hood) errors.neighborhood = 'Pick a neighborhood.';
  const tabs = [...new Set((draft.tabs || []).filter((t) => TAB_IDS.includes(t)))].slice(0, LIMITS.tabsMax);
  const prompts = (draft.prompts || [])
    .filter((p) => p && PROMPT_IDS.includes(p.id))
    .map((p) => ({ id: p.id, a: clean(p.a, LIMITS.promptMax) }))
    .filter((p) => p.a.length > 0);
  const seen = new Set();
  const uniqPrompts = prompts.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  if (uniqPrompts.length < LIMITS.promptsRequired) errors.prompts = `Answer ${LIMITS.promptsRequired} prompts in your own words.`;
  const photoCount = Number(draft.photoCount ?? 0);
  if (photoCount < 1) errors.photos = 'Add at least one photo.';
  if (photoCount > LIMITS.photosMax) errors.photos = `Up to ${LIMITS.photosMax} photos.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    profile: { firstName, birthYear: Number(draft.birthYear), neighborhood: hood, tabs, prompts: uniqPrompts.slice(0, 3) },
  };
}

/** Intent is private. It never appears on a card. */
export function validateIntent(draft) {
  const datingOpen = Boolean(draft.datingOpen);
  if (!datingOpen) return { ok: true, intent: { datingOpen: false, gender: null, seeking: [] } };
  const gender = GENDERS.includes(draft.gender) ? draft.gender : null;
  const seeking = [...new Set((draft.seeking || []).filter((g) => GENDERS.includes(g)))];
  if (!gender) return { ok: false, errors: { gender: 'Needed for the dating lane only. Never shown.' } };
  if (!seeking.length) return { ok: false, errors: { seeking: 'Who would you like to meet?' } };
  return { ok: true, intent: { datingOpen: true, gender, seeking } };
}

// ---------------------------------------------------------------- lanes

export const LANES = ['friends', 'dating'];

/**
 * Can `viewer` see `target` in `lane`? Mirrors st_can_see.
 * friends: everyone visible. dating: both open, mutual gender/seeking.
 * Blocks/hides/suppression are applied by the caller (they're relations, not profile facts).
 */
export function canSee(viewer, target, lane) {
  if (!viewer || !target || viewer.id === target.id) return false;
  if (!target.visible) return false;
  if (lane === 'friends') return true;
  if (lane !== 'dating') return false;
  const v = viewer.intent, t = target.intent;
  if (!v?.datingOpen || !t?.datingOpen) return false;
  return v.seeking.includes(t.gender) && t.seeking.includes(v.gender);
}

/** Order browse: people going to a plan first (plan context is the hook), then newest. */
export function orderBrowse(cards) {
  return [...cards].sort((a, b) => {
    const ap = a.plans?.length ? 1 : 0, bp = b.plans?.length ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
}

// ---------------------------------------------------------------- hi / wave

export function validateHi(note) {
  const n = clean(note, LIMITS.hiMax);
  if (!n) return { ok: false, error: 'One line — that’s the whole opener.' };
  return { ok: true, note: n };
}

/** Weekly dating-lane cap. `sentAt` = timestamps of this sender's dating hi's. */
export function datingHiAllowed(sentAt, now) {
  const weekAgo = new Date(now).getTime() - 7 * 86400e3;
  const recent = sentAt.filter((t) => new Date(t).getTime() > weekAgo).length;
  return { allowed: recent < LIMITS.datingHiPerWeek, remaining: Math.max(0, LIMITS.datingHiPerWeek - recent) };
}

export function hiExpired(createdAt, now) {
  return new Date(now).getTime() - new Date(createdAt).getTime() > LIMITS.hiExpiryDays * 86400e3;
}

// ---------------------------------------------------------------- chat / cards

export function validateMessage(body) {
  const b = String(body ?? '').replace(/\s+$/g, '').trim();
  if (!b) return { ok: false, error: 'Say something first.' };
  if (b.length > LIMITS.messageMax) return { ok: false, error: `Keep it under ${LIMITS.messageMax} characters.` };
  return { ok: true, body: b };
}

/** Deterministic pick of an undealt question. `used` = ids already dealt in this chat. */
export function pickQuestion(deck, used, seed) {
  const pool = deck.filter((q) => !used.includes(q.id));
  if (!pool.length) return null;
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return pool[h % pool.length];
}

export function cardRevealed(card) {
  return Boolean(card && card.answerA && card.answerB);
}

// Self-prompts: about YOU, never an analysis of them.
export const SELF_PROMPTS = [
  'What do you actually want to know about them? Ask that.',
  'Tell them the last thing that made you laugh this week.',
  'What would you do in Burlington this weekend if they said yes?',
  'Ask what they’d put on a two-hour tour of their neighborhood.',
  'Share the small thing you’re weirdly good at.',
  'Ask which of their two prompts was harder to answer.',
];

// ---------------------------------------------------------------- plans

/** Map an events.json category/title to a Small Talk tab (or null). Mirrors scripts/build-plans.mjs. */
export function tabForEvent(ev) {
  const t = `${ev.title ?? ''} ${ev.description ?? ''}`.toLowerCase();
  const cat = String(ev.category ?? '').toLowerCase();
  const has = (words) => new RegExp(`\\b(${words})\\b`, 'i').test(t);
  if (has('dogs?|puppy|puppies|canine')) return 'dogs';
  if (cat === 'outdoors' || has('hike|hiking|trail|trails|paddle|paddling|kayak|canoe|skiing|snowshoe|bike ride|cycling|summit|birding|bird walk')) return 'trails';
  if (cat === 'music') return 'music';
  if (cat === 'games' || has('board games?|cribbage|trivia|chess|cards|game night|bingo|mahjong|euchre|puzzle')) return 'games';
  return null;
}

/** Up For It category ids → Small Talk tabs (null = shows in Plans, not under a tab). */
export const UF_CATEGORY_TO_TAB = Object.freeze({ outdoors: 'trails', games: 'games', music: 'music', sports: 'trails' });

/**
 * Shape an Up For It row (uf_plans_public) into a plan. Their statuses:
 * 'tipping' (never shown here — a dating-app "I'm in" must not move a tip),
 * 'on' (+ starts_at) = our dated, 'done' = our happened, 'cancelled' = skip.
 */
// links rendered as href must be real web links — anything else (javascript:, data:) becomes null
export function httpsOnly(u) { const s = String(u ?? '').trim(); return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : null; }

export function planFromUpForIt(row) {
  if (!row) return null;
  const status = row.status === 'on' && row.starts_at ? 'dated' : row.status === 'done' ? 'happened' : null;
  if (!status) return null;
  return {
    id: `uf:${row.id}`,
    title: String(row.title ?? '').slice(0, 80),
    place: String(row.place ?? '').slice(0, 60),
    neighborhood: null,
    startsAt: row.starts_at,
    endsAt: null,
    tab: UF_CATEGORY_TO_TAB[row.category] ?? null,
    cap: row.cap ?? null,
    going: Number(row.in_count ?? 0),
    showed: row.showed ?? null,
    host: row.host_name ? String(row.host_name).split(' ')[0].slice(0, 24) : null,
    url: httpsOnly(row.meetup_url),
    source: 'upforit',
    status,
  };
}

/** Next N plans from a merged feed, soonest first, within a window. */
export function upcomingPlans(plans, now, days = 10) {
  const t0 = new Date(now).getTime(), t1 = t0 + days * 86400e3;
  return plans
    .filter((p) => { const t = new Date(p.startsAt).getTime(); return t >= t0 - 3600e3 && t <= t1; })
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

// ---------------------------------------------------------------- ready to meet

/**
 * Build the three Ready-to-meet options. Order: a plan you're BOTH into (or both
 * tagged for), then a place from the curated list matching shared tabs, then the
 * low-key standing option (Saturday coffee) — always last, never the frame.
 */
export function meetOptions({ me, them, plans, places, now, standing }) {
  const shared = me.tabs.filter((t) => them.tabs.includes(t));
  const upcoming = upcomingPlans(plans, now, 10);
  const both = upcoming.filter((p) => me.planIds?.includes(p.id) && them.planIds?.includes(p.id));
  const either = upcoming.filter((p) => (me.planIds?.includes(p.id) || them.planIds?.includes(p.id)) && !both.includes(p));
  const tagged = upcoming.filter((p) => p.tab && shared.includes(p.tab) && !both.includes(p) && !either.includes(p));
  const out = [];
  const planPick = both[0] || either[0] || tagged[0];
  if (planPick) out.push({ kind: 'plan', plan: planPick, why: both[0] ? "You're both in" : either[0] ? 'One of you is already in' : `You both like ${TABS.find((t) => t.id === planPick.tab)?.label.toLowerCase()}` });
  const placePool = places.filter((p) => !p.tab || shared.includes(p.tab));
  const seedless = placePool.length ? placePool : places;
  for (const p of seedless) {
    if (out.length >= LIMITS.meetPlaces - 1) break;
    out.push({ kind: 'place', place: p, why: p.why });
  }
  if (standing) out.push({ kind: 'standing', plan: standing, why: 'Low-key, big group, easy exit' });
  return out.slice(0, LIMITS.meetPlaces);
}

// ---------------------------------------------------------------- after / reliability

export const AFTER = ['good', 'fine', 'report'];

/**
 * Private who-showed signal. Never rendered on a profile; used only to rank
 * browse and weight reports. Returns 0..1; unknown people are 0.5.
 */
export function reliability({ confirmed, showed }) {
  if (!confirmed) return 0.5;
  return Math.max(0, Math.min(1, showed / confirmed));
}

// ---------------------------------------------------------------- ratio (the app-killer)

/** Dating-lane ratio check. counts = { woman: n, man: n, nonbinary: n }. */
export function ratioStatus(counts, threshold = 0.7) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total < 20) return { ok: true, heavy: null, share: 0, total, note: 'too few to judge' };
  let heavy = null, share = 0;
  for (const [g, n] of Object.entries(counts)) { const s = n / total; if (s > share) { share = s; heavy = g; } }
  return { ok: share <= threshold, heavy, share, total, note: share > threshold ? `pause new ${heavy} dating-lane signups` : 'balanced enough' };
}

// ---------------------------------------------------------------- copy helpers

export function tabLabel(id) { return TABS.find((t) => t.id === id)?.label ?? id; }
export function hoodLabel(id) { return NEIGHBORHOODS.find((n) => n.id === id)?.label ?? id; }

export function fmtWhen(iso, now) {
  const d = new Date(iso), n = new Date(now);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const sameDay = d.toDateString() === n.toDateString();
  const tomorrow = new Date(n.getTime() + 86400e3).toDateString() === d.toDateString();
  const h = d.getHours(), m = d.getMinutes();
  const time = `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
  return `${sameDay ? 'Today' : tomorrow ? 'Tomorrow' : day} ${time}`;
}
