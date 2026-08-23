// node --test scripts/test-core.mjs — core rules + the fake backend mirror.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clean, validateProfile, validateIntent, canSee, validateHi, datingHiAllowed, hiExpired,
  validateMessage, pickQuestion, tabForEvent, planFromUpForIt, upcomingPlans, meetOptions,
  reliability, ratioStatus, fmtWhen, LIMITS, RATE, httpsOnly,
} from '../js/core.js';
import { FakeBackend, seedDemo, DEMO_UID } from '../js/fake-backend.js';

const NOW = Date.parse('2026-08-23T15:00:00-04:00');

test('clean strips urls and collapses whitespace', () => {
  assert.equal(clean('  hi   there www.spam.com ok http://x.y/z  '), 'hi there ok');
  assert.equal(clean('visit foo.com/deal now'), 'visit now');
  assert.equal(clean('a'.repeat(200), 140).length, 140);
});

test('profile validation: 18+, two prompts, a photo, known neighborhood', () => {
  const base = { firstName: ' Maya ', birthYear: 1995, neighborhood: 'one', tabs: ['trails', 'trails', 'nope'], prompts: [{ id: 'weekend', a: 'hike' }, { id: 'lately', a: 'bread' }, { id: 'weekend', a: 'dup' }], photoCount: 1 };
  const ok = validateProfile(base, NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.profile.firstName, 'Maya');
  assert.deepEqual(ok.profile.tabs, ['trails']);
  assert.equal(ok.profile.prompts.length, 2);
  assert.equal(validateProfile({ ...base, birthYear: 2010 }, NOW).errors.birthYear.includes('18'), true);
  assert.ok(validateProfile({ ...base, prompts: [{ id: 'weekend', a: 'x' }] }, NOW).errors.prompts);
  assert.ok(validateProfile({ ...base, photoCount: 0 }, NOW).errors.photos);
  assert.ok(validateProfile({ ...base, neighborhood: 'paris' }, NOW).errors.neighborhood);
});

test('intent: private, requires gender+seeking only when open', () => {
  assert.deepEqual(validateIntent({ datingOpen: false }).intent, { datingOpen: false, gender: null, seeking: [] });
  assert.equal(validateIntent({ datingOpen: true, gender: 'woman' }).ok, false);
  assert.deepEqual(validateIntent({ datingOpen: true, gender: 'woman', seeking: ['man', 'man'] }).intent.seeking, ['man']);
});

test('lanes: friends sees all visible; dating needs both open + mutual seeking', () => {
  const w = { id: 'w', visible: true, intent: { datingOpen: true, gender: 'woman', seeking: ['man'] } };
  const m = { id: 'm', visible: true, intent: { datingOpen: true, gender: 'man', seeking: ['woman'] } };
  const m2 = { id: 'm2', visible: true, intent: { datingOpen: true, gender: 'man', seeking: ['man'] } };
  const f = { id: 'f', visible: true, intent: { datingOpen: false, seeking: [] } };
  assert.equal(canSee(w, f, 'friends'), true);
  assert.equal(canSee(w, m, 'dating'), true);
  assert.equal(canSee(w, m2, 'dating'), false);
  assert.equal(canSee(w, f, 'dating'), false);
  assert.equal(canSee(f, w, 'dating'), false);
  assert.equal(canSee(w, { ...m, visible: false }, 'friends'), false);
  assert.equal(canSee(w, w, 'friends'), false);
});

test('hi: one line, ≤140, dating cap 5/week, expiry 7 days', () => {
  assert.equal(validateHi('   ').ok, false);
  assert.equal(validateHi('hey www.x.com there').note, 'hey there');
  const sent = [0, 1, 2, 3].map((d) => new Date(NOW - d * 86400e3).toISOString());
  assert.deepEqual(datingHiAllowed(sent, NOW), { allowed: true, remaining: 1 });
  assert.equal(datingHiAllowed([...sent, new Date(NOW - 6 * 86400e3).toISOString()], NOW).allowed, false);
  assert.equal(datingHiAllowed([...sent, new Date(NOW - 8 * 86400e3).toISOString()], NOW).allowed, true);
  assert.equal(hiExpired(new Date(NOW - 8 * 86400e3).toISOString(), NOW), true);
  assert.equal(hiExpired(new Date(NOW - 6 * 86400e3).toISOString(), NOW), false);
});

test('message + question picking', () => {
  assert.equal(validateMessage(' ').ok, false);
  assert.equal(validateMessage('x'.repeat(1001)).ok, false);
  const deck = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const q = pickQuestion(deck, ['a'], 'seed');
  assert.ok(['b', 'c'].includes(q.id));
  assert.equal(pickQuestion(deck, ['a'], 'seed').id, q.id, 'deterministic for a seed');
  assert.equal(pickQuestion(deck, ['a', 'b', 'c'], 'seed'), null);
});

test('plans: event → tab, Up For It adapter only passes on/done, upcoming window', () => {
  assert.equal(tabForEvent({ title: 'Weekly Bird Walk', category: 'outdoors' }), 'trails');
  assert.equal(tabForEvent({ title: 'Puppy social', category: 'community' }), 'dogs');
  assert.equal(tabForEvent({ title: 'Trivia night', category: 'other' }), 'games');
  assert.equal(tabForEvent({ title: 'Poetry reading', category: 'words' }), null);
  assert.equal(planFromUpForIt({ id: '1', status: 'tipping', starts_at: null }), null);
  assert.equal(planFromUpForIt({ id: '1', status: 'on', starts_at: null }), null, 'on without a date is not dated yet');
  const p = planFromUpForIt({ id: '1', status: 'on', starts_at: '2026-08-27T20:00:00Z', title: 'Pickleball', place: 'Leddy', category: 'sports', in_count: 7, cap: 12, host_name: 'Jonathon Q', meetup_url: '' });
  assert.equal(p.id, 'uf:1'); assert.equal(p.tab, 'trails'); assert.equal(p.host, 'Jonathon'); assert.equal(p.url, null); assert.equal(p.status, 'dated');
  assert.equal(planFromUpForIt({ id: '2', status: 'done', starts_at: '2026-08-20T20:00:00Z', showed: 5 }).status, 'happened');
  const plans = [{ id: 'x', startsAt: new Date(NOW + 86400e3).toISOString() }, { id: 'old', startsAt: new Date(NOW - 3 * 86400e3).toISOString() }, { id: 'far', startsAt: new Date(NOW + 20 * 86400e3).toISOString() }];
  assert.deepEqual(upcomingPlans(plans, NOW, 10).map((p) => p.id), ['x']);
});

test('meet options: plan-together first, then places by shared tab, standing last', () => {
  const plans = [{ id: 'p1', title: 'Kat Wright', tab: 'music', startsAt: new Date(NOW + 2 * 86400e3).toISOString() }];
  const places = [{ name: 'Dobra', tab: null, why: 'quiet' }, { name: 'Oakledge', tab: 'dogs', why: 'dogs' }, { name: 'Radio Bean', tab: 'music', why: 'music' }];
  const standing = { id: 's', title: 'Saturday coffee', startsAt: new Date(NOW + 3 * 86400e3).toISOString() };
  const o = meetOptions({ me: { tabs: ['music'], planIds: ['p1'] }, them: { tabs: ['music', 'games'], planIds: [] }, plans, places, now: NOW, standing });
  assert.equal(o.length, 3);
  assert.equal(o[0].kind, 'plan'); assert.equal(o[0].why, 'One of you is already in');
  assert.equal(o[1].kind, 'place'); assert.equal(o[1].place.name, 'Dobra');
  assert.equal(o[2].kind, 'standing');
  const o2 = meetOptions({ me: { tabs: ['dogs'], planIds: [] }, them: { tabs: ['dogs'], planIds: [] }, plans, places, now: NOW, standing: null });
  assert.equal(o2[0].kind, 'place'); assert.equal(o2.length, 2, 'no plan, no standing → two places');
  assert.ok(o2.some((x) => x.place?.name === 'Oakledge'));
});

test('reliability + ratio', () => {
  assert.equal(reliability({ confirmed: 0, showed: 0 }), 0.5);
  assert.equal(reliability({ confirmed: 4, showed: 3 }), 0.75);
  assert.equal(ratioStatus({ woman: 3, man: 5 }).note, 'too few to judge');
  const r = ratioStatus({ woman: 6, man: 20, nonbinary: 1 });
  assert.equal(r.ok, false); assert.equal(r.heavy, 'man');
  assert.equal(ratioStatus({ woman: 12, man: 14 }).ok, true);
});

test('fmtWhen', () => {
  const d = new Date(NOW); d.setHours(19, 30, 0, 0);
  assert.equal(fmtWhen(d.toISOString(), NOW), 'Today 7:30pm');
});

// ------------------------------------------------------------- fake backend mirror

function fb() { return seedDemo(new FakeBackend({ now: () => NOW })); }
const maya = 'seed-0001-0000-0000-000000000000';
const jonah = 'seed-0002-0000-0000-000000000000';

test('links from the plans feed must be http(s) — anything else is dropped', () => {
  assert.equal(httpsOnly('https://www.meetup.com/x'), 'https://www.meetup.com/x');
  assert.equal(httpsOnly('http://example.org/a?b=1'), 'http://example.org/a?b=1');
  assert.equal(httpsOnly('javascript:alert(1)'), null);
  assert.equal(httpsOnly('data:text/html,hi'), null);
  assert.equal(httpsOnly(''), null); assert.equal(httpsOnly(null), null);
  assert.equal(planFromUpForIt({ id: 'p1', title: 'Trivia', status: 'on', starts_at: new Date(NOW + 86400e3).toISOString(), place: 'Zero Gravity', meetup_url: 'javascript:alert(1)' }).url, null);
});

test('fake backend: a profile needs a photo, keeps its last photo, and says hi to at most 15 people a week', async () => {
  const b = fb(); b.signIn();
  await assert.rejects(b.rpc('st_save_profile', { p: { firstName: 'Sam', birthYear: 1990, neighborhood: 'downtown', prompts: [{ id: 'weekend', a: 'a' }, { id: 'lately', a: 'b' }] } }), { code: 'no_photo' });
  b.uploadPhoto(DEMO_UID, 0);
  await assert.rejects(b.rpc('st_save_profile', { p: { firstName: 'Sam', birthYear: 1990, neighborhood: 'mars', prompts: [{ id: 'weekend', a: 'a' }, { id: 'lately', a: 'b' }] } }), { code: 'bad_profile' }, 'neighborhood validated');
  await b.rpc('st_save_profile', { p: { firstName: 'Sam', birthYear: 1990, neighborhood: 'downtown', prompts: [{ id: 'weekend', a: 'a' }, { id: 'lately', a: 'b' }] } });
  await assert.rejects(b.rpc('st_remove_photo', { p_idx: 0 }), { code: 'last_photo' });
  b.uploadPhoto(DEMO_UID, 1);
  await b.rpc('st_remove_photo', { p_idx: 0 });
  // weekly distinct-recipient ceiling, friends lane
  const people = (await b.rpc('st_browse', { p_lane: 'friends' })).map((c) => c.id);
  for (let i = 0; i < RATE.hiPeoplePerWeek; i++) b.hellos.push({ id: 'w' + i, from: DEMO_UID, to: 'ghost-' + i, lane: 'friends', note: 'x', status: 'open', createdAt: new Date(NOW - 3600e3).toISOString(), expiresAt: new Date(NOW + 6 * 86400e3).toISOString() });
  await assert.rejects(b.rpc('st_hi', { p_to: people[0], p_lane: 'friends', p_note: 'one more' }), { code: 'slow_down' });
});

test('fake backend: sign-in → profile → browse lanes → hi cap → wave → chat → card → meet → after', async () => {
  const b = fb();
  await assert.rejects(b.rpc('st_me'), { code: 'not_signed_in' });
  b.signIn();
  assert.equal((await b.rpc('st_me')).profile, null);
  await assert.rejects(b.rpc('st_browse', {}), { code: 'no_profile' });
  await assert.rejects(b.rpc('st_save_profile', { p: { firstName: 'K', birthYear: 2012, neighborhood: 'one', prompts: [{ id: 'weekend', a: 'a' }, { id: 'lately', a: 'b' }] } }), { code: 'too_young' });
  b.uploadPhoto(DEMO_UID, 0);
  let me = await b.rpc('st_save_profile', { p: { firstName: 'Sam', birthYear: 1990, neighborhood: 'downtown', tabs: ['games'], prompts: [{ id: 'weekend', a: 'cards' }, { id: 'lately', a: 'bread http://spam.io' }] } });
  assert.equal(me.profile.prompts[1].a, 'bread');
  me = await b.rpc('st_set_intent', { p: { datingOpen: true, gender: 'man', seeking: ['woman'] } });
  assert.equal(me.datingHiRemaining, 5);
  const friends = await b.rpc('st_browse', { p_lane: 'friends' });
  assert.equal(friends.length, 10);
  assert.ok(friends.every((c) => !('intent' in c) && !('gender' in c)), 'intent never leaks');
  assert.equal(friends[0].plans.length > 0, true, 'people going to a plan sort first');
  const dating = await b.rpc('st_browse', { p_lane: 'dating' });
  assert.deepEqual(dating.map((c) => c.firstName).sort(), ['Hana', 'Lena', 'Maya'], 'women seeking men only');
  assert.equal((await b.rpc('st_browse', { p_lane: 'friends', p_tab: 'dogs' })).length, 3);
  // hi: dating cap
  for (const c of dating) await b.rpc('st_hi', { p_to: c.id, p_lane: 'dating', p_note: 'hi ' + c.firstName });
  await assert.rejects(b.rpc('st_hi', { p_to: maya, p_lane: 'dating', p_note: 'again' }), { code: 'already_said_hi' });
  assert.equal((await b.rpc('st_me')).datingHiRemaining, 2);
  await b.rpc('st_hi', { p_to: jonah, p_lane: 'friends', p_note: 'cribbage?' });
  assert.equal((await b.rpc('st_browse', { p_lane: 'dating' }))[0].hi.status, 'open');
  await assert.rejects(b.rpc('st_hi', { p_to: DEMO_UID, p_lane: 'friends', p_note: 'me' }), { code: 'not_found' });
  // "Not now" on Maya's side is invisible to Sam: his card still says hi open, he can't re-hi, the sent list is unchanged
  {
    const sentBefore = (await b.rpc('st_inbox')).sent.length;
    b.signIn(maya, 'maya@example.com');
    const hiFromSam = (await b.rpc('st_inbox')).received.find((r) => r.from.firstName === 'Sam');
    await b.rpc('st_hi_pass', { p_hello: hiFromSam.id });
    assert.equal((await b.rpc('st_inbox')).received.some((r) => r.from.firstName === 'Sam'), false, 'gone from her inbox');
    b.signIn();
    assert.equal((await b.rpc('st_browse', { p_lane: 'dating' })).find((c) => c.id === maya).hi.status, 'open', 'sender sees nothing');
    assert.equal((await b.rpc('st_inbox')).sent.length, sentBefore, 'sent list unchanged');
    await assert.rejects(b.rpc('st_hi', { p_to: maya, p_lane: 'dating', p_note: 'again' }), { code: 'already_said_hi' });
    // after expiry the re-hi is accepted but stays passed: she is never bothered again
    b.hellos.find((x) => x.from === DEMO_UID && x.to === maya).expiresAt = new Date(NOW - 1000).toISOString();
    assert.equal((await b.rpc('st_hi', { p_to: maya, p_lane: 'dating', p_note: 'again' })).status, 'open');
    assert.equal(b.hellos.find((x) => x.from === DEMO_UID && x.to === maya).status, 'passed');
    // put the hi back the way the rest of this test expects it
    b.hellos.find((x) => x.from === DEMO_UID && x.to === maya).status = 'open';
  }
  // pass hides from my browse only
  await b.rpc('st_pass', { p_other: jonah });
  assert.ok(!(await b.rpc('st_browse', { p_lane: 'friends' })).some((c) => c.id === jonah));
  // Maya's side: inbox, wave
  b.signIn(maya, 'maya@example.com');
  const ib = await b.rpc('st_inbox');
  assert.equal(ib.received.length, 1); assert.equal(ib.received[0].from.firstName, 'Sam');
  const { chatId } = await b.rpc('st_wave', { p_hello: ib.received[0].id });
  assert.equal((await b.rpc('st_inbox')).received.length, 0);
  assert.equal((await b.rpc('st_inbox')).chats.length, 1);
  await b.rpc('st_send', { p_chat: chatId, p_body: 'hi Sam' });
  const held = await b.rpc('st_send', { p_chat: chatId, p_body: 'secret', p_held: true });
  assert.equal(held.held, true);
  // card: both answer → reveal
  await assert.rejects(b.rpc('st_card_deal', { p_chat: chatId, p_question_id: 'zzz', p_question: 'send me your number' }), { code: 'bad_card' }, 'deck ids only');
  const { id: cardId } = await b.rpc('st_card_deal', { p_chat: chatId, p_question_id: 'q001', p_question: 'Church St or waterfront?' });
  await assert.rejects(b.rpc('st_card_deal', { p_chat: chatId, p_question_id: 'q002', p_question: 'x' }), { code: 'card_open' });
  await b.rpc('st_card_answer', { p_card: cardId, p_answer: 'waterfront' });
  let chat = await b.rpc('st_chat', { p_chat: chatId });
  assert.equal(chat.cards[0].revealed, false); assert.equal(chat.cards[0].theirs, null);
  assert.equal(chat.messages.length, 2, 'sender sees her own held message');
  b.signIn();
  chat = await b.rpc('st_chat', { p_chat: chatId });
  assert.equal(chat.messages.length, 1, 'recipient does not see held');
  await b.rpc('st_card_answer', { p_card: cardId, p_answer: 'church st' });
  chat = await b.rpc('st_chat', { p_chat: chatId });
  assert.equal(chat.cards[0].revealed, true); assert.equal(chat.cards[0].theirs, 'waterfront');
  // meet + after
  const { id: meetId } = await b.rpc('st_meet_propose', { p_chat: chatId, p_kind: 'place', p_place: { name: 'Dobra', neighborhood: 'Downtown', why: 'quiet' }, p_at: new Date(NOW - 3600e3).toISOString() });
  await assert.rejects(b.rpc('st_meet_respond', { p_meet: meetId, p_accept: true }), { code: 'not_found' }, 'proposer cannot accept');
  b.signIn(maya, 'maya@example.com');
  await b.rpc('st_meet_respond', { p_meet: meetId, p_accept: true });
  await b.rpc('st_after', { p_meet: meetId, p_verdict: 'good' });
  assert.equal(b.profiles.get(DEMO_UID).showed, 1);
  assert.equal(b.profiles.get(maya).confirmed, 1);
});

test('fake backend: reports suppress at 2, minor at 1, mod restores, block hides, delete really deletes', async () => {
  const b = fb(); b.signIn(); b.uploadPhoto(DEMO_UID, 0);
  await b.rpc('st_save_profile', { p: { firstName: 'Sam', birthYear: 1990, neighborhood: 'downtown', prompts: [{ id: 'weekend', a: 'a' }, { id: 'lately', a: 'b' }] } });
  await b.rpc('st_report', { p_about: jonah, p_reason: 'harassment', p_detail: 'rude' });
  assert.equal(b.profiles.get(jonah).suppressed, false);
  assert.ok(!(await b.rpc('st_browse', {})).some((c) => c.id === jonah), 'reporter auto-blocks');
  b.signIn(maya, 'maya@example.com');
  await b.rpc('st_report', { p_about: jonah, p_reason: 'fake' });
  assert.equal(b.profiles.get(jonah).suppressed, true);
  await assert.rejects(b.rpc('st_mod_queue'), { code: 'not_mod' });
  b.signIn('seed-0010-0000-0000-000000000000', 'stephenvdavis@gmail.com');
  const q = await b.rpc('st_mod_queue');
  assert.equal(q.reports.length, 2); assert.equal(q.suppressed.length, 1);
  await b.rpc('st_mod_act', { p_kind: 'profile', p_id: jonah, p_action: 'restore' });
  assert.equal(b.profiles.get(jonah).suppressed, false);
  assert.equal((await b.rpc('st_mod_queue')).reports.length, 0);
  b.signIn(); await b.rpc('st_report', { p_about: 'seed-0003-0000-0000-000000000000', p_reason: 'minor' });
  assert.equal(b.profiles.get('seed-0003-0000-0000-000000000000').suppressed, true);
  // block
  b.signIn(maya, 'maya@example.com');
  await b.rpc('st_block', { p_other: 'seed-0004-0000-0000-000000000000' });
  assert.ok(!(await b.rpc('st_browse', {})).some((c) => c.id === 'seed-0004-0000-0000-000000000000'));
  b.signIn('seed-0004-0000-0000-000000000000', 'theo@example.com');
  assert.ok(!(await b.rpc('st_browse', {})).some((c) => c.id === maya), 'blocked both ways');
  // public stats never leak names
  const s = await b.rpc('st_public_stats');
  assert.ok(s.members >= 10); assert.ok(s.fragments.every((f) => !f.firstName));
  // delete
  b.signIn(maya, 'maya@example.com');
  await b.rpc('st_delete_me');
  assert.equal(b.profiles.has(maya), false); assert.equal(b.session(), null);
});

test('fake backend: plans people (counts for anon, opted-in names for members) + Up For It filter', async () => {
  const b = fb();
  const anon = await b.rpc('st_plan_people', { p_plans: ['demo:music-thu'] });
  assert.equal(anon['demo:music-thu'].count, 2); assert.deepEqual(anon['demo:music-thu'].names, []);
  b.signIn(); b.uploadPhoto(DEMO_UID, 0);
  await b.rpc('st_save_profile', { p: { firstName: 'Sam', birthYear: 1990, neighborhood: 'downtown', prompts: [{ id: 'weekend', a: 'a' }, { id: 'lately', a: 'b' }] } });
  const m = await b.rpc('st_plan_people', { p_plans: ['demo:music-thu', 'demo:games-sun'] });
  assert.deepEqual(m['demo:music-thu'].names.sort(), ['Maya', 'Theo']);
  assert.deepEqual(m['demo:games-sun'].names, [], 'Jonah did not opt to show his name');
  await b.rpc('st_plan_join', { p_plan: 'demo:games-sun', p_show_name: true });
  assert.equal((await b.rpc('st_plan_people', { p_plans: ['demo:games-sun'] }))['demo:games-sun'].mine, true);
  const uf = b.plansFromUpForIt().filter((p) => p.source === 'upforit');
  assert.equal(uf.length, 1, 'tipping plan never shows');
  assert.equal(uf[0].tab, 'trails');
});

void LIMITS;
