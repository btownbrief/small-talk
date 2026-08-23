// SMALL TALK — in-memory mirror of supabase/small-talk-SETUP.sql for ?demo=1
// and the Playwright playtest. Same RPC names, same error codes, same rules
// (mirrors js/core.js). Saves nothing. Seeded with a small Burlington cast.

import { clean, canSee, LIMITS, RATE, planFromUpForIt } from './core.js';

const DEMO_UID = 'demo-0000-0000-0000-000000000000';
const err = (code) => { const e = new Error(code); e.code = code; return e; };
let seq = 0;
const uid = (p = 'id') => `${p}-${(++seq).toString(36).padStart(6, '0')}`;
const iso = (t) => new Date(t).toISOString();
const DAY = 86400e3;

export class FakeBackend {
  constructor({ now } = {}) {
    this.now = now ?? Date.now;
    this.users = new Map();     // id → { email }
    this.profiles = new Map();  // id → profile row
    this.intents = new Map();
    this.photos = new Map();    // id → [{idx,path,status}]
    this.hellos = [];
    this.passes = new Set();    // `${u}|${o}`
    this.chats = [];
    this.messages = [];
    this.cards = [];
    this.planMembers = [];
    this.meets = [];
    this.blocks = new Map();    // `${u}|${o}` → kind
    this.reports = [];
    this.mods = new Set(['stephenvdavis@gmail.com']);
    this.sessionUser = null;
    this.authCbs = [];
    this.subs = new Map();
    this.ufPlans = [];
    this.demoPlans = [];  // stands in for data/plans.json (events) in the demo
  }

  // ---------------------------------------------------------- auth
  session() { return this.sessionUser ? { user: { id: this.sessionUser, email: this.users.get(this.sessionUser)?.email } } : null; }
  onAuth(cb) { this.authCbs.push(cb); }
  signIn(id = DEMO_UID, email = 'you@example.com') {
    if (!this.users.has(id)) this.users.set(id, { email });
    this.sessionUser = id;
    for (const cb of this.authCbs) cb(this.session());
  }
  signOut() { this.sessionUser = null; for (const cb of this.authCbs) cb(null); }
  uploadPhoto(u, idx) {
    const path = `${u}/${idx}.jpg`;
    const list = this.photos.get(u) || [];
    const i = list.findIndex((p) => p.idx === idx);
    const row = { idx, path, status: 'ok' };
    if (i >= 0) list[i] = row; else list.push(row);
    this.photos.set(u, list.sort((a, b) => a.idx - b.idx));
    return path;
  }
  photoUrls(paths) {
    const out = {};
    for (const p of paths || []) out[p] = gradientFor(p);
    return out;
  }
  subscribe(chatId, cb) { const k = uid('sub'); this.subs.set(k, { chatId, cb }); return () => this.subs.delete(k); }
  _changed(chatId) { for (const s of this.subs.values()) if (s.chatId === chatId) setTimeout(s.cb, 0); }
  plansFromUpForIt() { return [...this.ufPlans.map(planFromUpForIt).filter(Boolean), ...this.demoPlans]; }

  // ---------------------------------------------------------- helpers
  _uid() { if (!this.sessionUser) throw err('not_signed_in'); return this.sessionUser; }
  _isMod(u) { return this.mods.has(this.users.get(u)?.email); }
  _blocked(a, b) { return this.blocks.has(`${a}|${b}`) || this.blocks.has(`${b}|${a}`); }
  _excluded(v, t) { const p = this.profiles.get(t); return v === t || this._blocked(v, t) || !p || p.banned || p.suppressed || !p.visible; }
  _view(id) { const p = this.profiles.get(id); return p && { id, visible: p.visible, intent: this.intents.get(id) || { datingOpen: false, seeking: [] } }; }
  _age(y) { return new Date(this.now()).getUTCFullYear() - y; }
  _card(p, viewer) {
    const hi = this.hellos.find((h) => h.from === viewer && h.to === p.id && new Date(h.expiresAt) > this.now() && h.status !== 'passed');
    return {
      id: p.id, firstName: p.firstName, age: this._age(p.birthYear), neighborhood: p.neighborhood, tabs: [...p.tabs], prompts: p.prompts,
      photos: (this.photos.get(p.id) || []).filter((x) => x.status === 'ok').map((x) => x.path),
      plans: this.planMembers.filter((m) => m.user === p.id && m.showName).map((m) => m.plan),
      createdAt: p.createdAt, hi: hi ? { id: hi.id, status: hi.status } : null,
    };
  }
  _chatOf(id, u) { const c = this.chats.find((x) => x.id === id); if (!c || (c.a !== u && c.b !== u)) throw err('not_found'); return c; }
  _openChat(a, b, lane) {
    const [lo, hi] = [a, b].sort();
    let c = this.chats.find((x) => x.a === lo && x.b === hi);
    if (!c) { c = { id: uid('chat'), a: lo, b: hi, lane, createdAt: iso(this.now()), lastAt: iso(this.now()) }; this.chats.push(c); }
    c.lastAt = iso(this.now());
    return c;
  }
  _applyReports(about) {
    const p = this.profiles.get(about); if (!p) return;
    const n = new Set(this.reports.filter((r) => r.about === about && !r.resolvedAt).map((r) => r.from)).size;
    p.reports = n; p.suppressed = p.suppressed || n >= LIMITS.reportsToSuppress;
  }

  // ---------------------------------------------------------- rpc
  async rpc(fn, a = {}) {
    const m = this[`rpc_${fn}`];
    if (!m) throw err('not_ready');
    return m.call(this, a);
  }

  rpc_st_public_stats() {
    const vis = [...this.profiles.values()].filter((p) => p.visible && !p.banned);
    return { members: vis.length, fragments: vis.filter((p) => !p.suppressed).slice(0, 6).map((p) => ({ neighborhood: p.neighborhood, tabs: p.tabs })) };
  }

  rpc_st_me() {
    const u = this._uid(); const p = this.profiles.get(u);
    const base = { id: u, email: this.users.get(u)?.email, isMod: this._isMod(u) };
    if (!p) return { ...base, profile: null, intent: null };
    const i = this.intents.get(u) || { datingOpen: false, gender: null, seeking: [] };
    const weekAgo = this.now() - 7 * DAY;
    return {
      ...base,
      profile: { ...this._card(p, u), birthYear: p.birthYear, visible: p.visible, suppressed: p.suppressed,
        photosAll: this.photos.get(u) || [], planIds: this.planMembers.filter((m) => m.user === u).map((m) => m.plan) },
      intent: i,
      datingHiRemaining: Math.max(0, LIMITS.datingHiPerWeek - this.hellos.filter((h) => h.from === u && h.lane === 'dating' && new Date(h.createdAt) > weekAgo).length),
    };
  }

  rpc_st_save_profile({ p }) {
    const u = this._uid();
    const firstName = clean(p.firstName, 24); if (!firstName) throw err('bad_profile');
    const y = Number(p.birthYear); if (!Number.isInteger(y) || this._age(y) < 18 || this._age(y) > 110) throw err('too_young');
    const tabs = [...new Set((p.tabs || []).filter((t) => ['dogs', 'trails', 'music', 'games'].includes(t)))].slice(0, 4);
    const seen = new Set();
    const prompts = (p.prompts || []).map((x) => ({ id: x.id, a: clean(x.a, 140) })).filter((x) => x.a && !seen.has(x.id) && seen.add(x.id)).slice(0, 3);
    if (prompts.length < 2) throw err('bad_profile');
    const prev = this.profiles.get(u);
    this.profiles.set(u, { id: u, firstName, birthYear: y, neighborhood: p.neighborhood, tabs, prompts, visible: prev?.visible ?? true, suppressed: prev?.suppressed ?? false, banned: false, reports: prev?.reports ?? 0, confirmed: prev?.confirmed ?? 0, showed: prev?.showed ?? 0, createdAt: prev?.createdAt ?? iso(this.now()) });
    if (!prev && this.afterFirstProfile) this.afterFirstProfile(u);
    return this.rpc_st_me();
  }
  rpc_st_set_visible({ v }) { const p = this.profiles.get(this._uid()); if (p) p.visible = Boolean(v); }
  rpc_st_set_intent({ p }) {
    const u = this._uid();
    if (!p.datingOpen) { this.intents.set(u, { datingOpen: false, gender: null, seeking: [] }); return this.rpc_st_me(); }
    if (!['woman', 'man', 'nonbinary'].includes(p.gender)) throw err('bad_intent');
    const seeking = [...new Set((p.seeking || []).filter((g) => ['woman', 'man', 'nonbinary'].includes(g)))];
    if (!seeking.length) throw err('bad_intent');
    this.intents.set(u, { datingOpen: true, gender: p.gender, seeking });
    return this.rpc_st_me();
  }
  rpc_st_set_photo({ p_idx, p_path }) { const u = this._uid(); if (!p_path.startsWith(`${u}/`)) throw err('bad_photo'); this.uploadPhoto(u, p_idx); }
  rpc_st_remove_photo({ p_idx }) { const u = this._uid(); this.photos.set(u, (this.photos.get(u) || []).filter((x) => x.idx !== p_idx)); }

  rpc_st_browse({ p_lane = 'friends', p_tab = null, p_before = null }) {
    const u = this._uid(); if (!this.profiles.get(u)) throw err('no_profile');
    if (!['friends', 'dating'].includes(p_lane)) throw err('bad_lane');
    const me = this._view(u);
    return [...this.profiles.values()]
      .filter((p) => p.id !== u && !this._excluded(u, p.id) && canSee(me, this._view(p.id), p_lane) && !this.passes.has(`${u}|${p.id}`) && (!p_tab || p.tabs.includes(p_tab)) && (!p_before || p.createdAt < p_before))
      .sort((a, b) => (this.planMembers.some((m) => m.user === b.id && m.showName) - this.planMembers.some((m) => m.user === a.id && m.showName)) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, LIMITS.browsePage).map((p) => this._card(p, u));
  }

  rpc_st_hi({ p_to, p_lane, p_note }) {
    const u = this._uid(); const n = clean(p_note, LIMITS.hiMax);
    if (!['friends', 'dating'].includes(p_lane)) throw err('bad_lane');
    if (!n) throw err('bad_hi');
    if (p_to === u || !this.profiles.has(p_to) || this._excluded(u, p_to) || !canSee(this._view(u), this._view(p_to), p_lane)) throw err('not_found');
    const dayAgo = this.now() - DAY, weekAgo = this.now() - 7 * DAY;
    if (this.hellos.filter((h) => h.from === u && new Date(h.createdAt) > dayAgo).length >= RATE.hisPerDay) throw err('slow_down');
    if (p_lane === 'dating' && this.hellos.filter((h) => h.from === u && h.lane === 'dating' && new Date(h.createdAt) > weekAgo).length >= LIMITS.datingHiPerWeek) throw err('dating_cap');
    const ex = this.hellos.find((h) => h.from === u && h.to === p_to);
    if (ex && new Date(ex.expiresAt) > this.now() && ex.status !== 'passed') throw err('already_said_hi');
    if (ex) this.hellos.splice(this.hellos.indexOf(ex), 1);
    const h = { id: uid('hi'), from: u, to: p_to, lane: p_lane, note: n, status: 'open', createdAt: iso(this.now()), expiresAt: iso(this.now() + LIMITS.hiExpiryDays * DAY) };
    this.hellos.push(h);
    return { id: h.id, status: 'open' };
  }
  rpc_st_pass({ p_other }) { this.passes.add(`${this._uid()}|${p_other}`); }
  rpc_st_hi_pass({ p_hello }) { const u = this._uid(); const h = this.hellos.find((x) => x.id === p_hello && x.to === u); if (h) h.status = 'passed'; }
  rpc_st_wave({ p_hello }) {
    const u = this._uid(); const h = this.hellos.find((x) => x.id === p_hello && x.to === u && x.status === 'open' && new Date(x.expiresAt) > this.now());
    if (!h) throw err('not_found');
    h.status = 'waved';
    return { chatId: this._openChat(h.from, h.to, h.lane).id };
  }
  rpc_st_reply({ p_hello, p_body }) {
    const u = this._uid(); const b = String(p_body ?? '').trim(); if (!b || b.length > 1000) throw err('bad_message');
    const h = this.hellos.find((x) => x.id === p_hello && x.to === u && ['open', 'waved'].includes(x.status) && new Date(x.expiresAt) > this.now());
    if (!h) throw err('not_found');
    h.status = 'replied';
    const c = this._openChat(h.from, h.to, h.lane);
    this.messages.push({ id: uid('m'), chat: c.id, from: u, body: b, held: false, at: iso(this.now()) });
    this._changed(c.id);
    this._autoReply(c, h.from, b);
    return { chatId: c.id };
  }

  rpc_st_inbox() {
    const u = this._uid(); const now = this.now();
    return {
      received: this.hellos.filter((h) => h.to === u && h.status === 'open' && new Date(h.expiresAt) > now && !this._excluded(u, h.from) && this.profiles.has(h.from))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((h) => ({ id: h.id, lane: h.lane, note: h.note, createdAt: h.createdAt, from: this._card(this.profiles.get(h.from), u) })),
      sent: this.hellos.filter((h) => h.from === u && h.status === 'open' && new Date(h.expiresAt) > now && this.profiles.has(h.to))
        .map((h) => ({ id: h.id, toId: h.to, firstName: this.profiles.get(h.to).firstName, createdAt: h.createdAt })),
      chats: this.chats.filter((c) => (c.a === u || c.b === u) && !this._blocked(c.a, c.b)).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).map((c) => {
        const other = c.a === u ? c.b : c.a;
        const last = [...this.messages].reverse().find((m) => m.chat === c.id && (!m.held || m.from === u));
        return { id: c.id, lane: c.lane, lastAt: c.lastAt, other: this._card(this.profiles.get(other), u), last: last ? { body: last.body, fromMe: last.from === u, at: last.at } : null };
      }),
    };
  }

  rpc_st_chat({ p_chat, p_since = null }) {
    const u = this._uid(); const c = this._chatOf(p_chat, u); const other = c.a === u ? c.b : c.a;
    return {
      id: c.id, lane: c.lane, other: this._card(this.profiles.get(other), u), blocked: this._blocked(u, other),
      messages: this.messages.filter((m) => m.chat === c.id && (!m.held || m.from === u) && (!p_since || m.at > p_since)).map((m) => ({ id: m.id, fromMe: m.from === u, body: m.body, held: m.held, at: m.at })),
      cards: this.cards.filter((k) => k.chat === c.id).map((k) => ({ id: k.id, questionId: k.questionId, question: k.question, mine: k.answers[u] ?? null, theirs: k.revealedAt ? k.answers[other] ?? null : null, revealed: Boolean(k.revealedAt), at: k.at })),
      meets: this.meets.filter((m) => m.chat === c.id).map((m) => ({ id: m.id, mine: m.proposer === u, kind: m.kind, planId: m.planId, place: m.place, at: m.at, status: m.status, myAfter: m.after[u] ?? null, createdAt: m.createdAt })),
    };
  }
  rpc_st_send({ p_chat, p_body, p_held = false }) {
    const u = this._uid(); const b = String(p_body ?? '').trim(); if (!b || b.length > 1000) throw err('bad_message');
    const c = this._chatOf(p_chat, u); const other = c.a === u ? c.b : c.a;
    if (this._blocked(u, other)) throw err('blocked');
    const m = { id: uid('m'), chat: c.id, from: u, body: b, held: Boolean(p_held), at: iso(this.now()) };
    this.messages.push(m); c.lastAt = m.at; this._changed(c.id);
    if (!m.held) this._autoReply(c, other, b);
    return { id: m.id, at: m.at, held: m.held };
  }
  // demo only: the other person answers a beat later so the chat feels alive
  _autoReply(c, other, body) {
    const p = this.profiles.get(other); if (!p || !p.demoReplies?.length) return;
    const line = p.demoReplies.shift();
    setTimeout(() => { this.messages.push({ id: uid('m'), chat: c.id, from: other, body: line, held: false, at: iso(this.now()) }); c.lastAt = iso(this.now()); this._changed(c.id); }, 1200);
    void body;
  }
  rpc_st_card_deal({ p_chat, p_question_id, p_question }) {
    const u = this._uid(); const c = this._chatOf(p_chat, u);
    if (this.cards.some((k) => k.chat === c.id && !k.revealedAt)) throw err('card_open');
    const k = { id: uid('card'), chat: c.id, questionId: p_question_id, question: clean(p_question, 240), answers: {}, at: iso(this.now()), revealedAt: null };
    this.cards.push(k); c.lastAt = k.at; this._changed(c.id);
    // demo: the other side answers after a beat
    const other = c.a === u ? c.b : c.a; const p = this.profiles.get(other);
    if (p?.demoCardAnswer) setTimeout(() => { k.answers[other] = p.demoCardAnswer; if (k.answers[u]) k.revealedAt = iso(this.now()); this._changed(c.id); }, 1500);
    return { id: k.id };
  }
  rpc_st_card_answer({ p_card, p_answer }) {
    const u = this._uid(); const a = String(p_answer ?? '').trim(); if (!a || a.length > 280) throw err('bad_answer');
    const k = this.cards.find((x) => x.id === p_card); if (!k) throw err('not_found');
    const c = this._chatOf(k.chat, u); const other = c.a === u ? c.b : c.a;
    k.answers[u] = a; if (k.answers[other] && !k.revealedAt) k.revealedAt = iso(this.now());
    c.lastAt = iso(this.now()); this._changed(c.id);
    return { revealed: Boolean(k.revealedAt) };
  }

  rpc_st_plan_join({ p_plan, p_show_name = false }) {
    const u = this._uid(); const ex = this.planMembers.find((m) => m.plan === p_plan && m.user === u);
    if (ex) ex.showName = Boolean(p_show_name); else this.planMembers.push({ plan: p_plan, user: u, showName: Boolean(p_show_name) });
  }
  rpc_st_plan_leave({ p_plan }) { const u = this._uid(); this.planMembers = this.planMembers.filter((m) => !(m.plan === p_plan && m.user === u)); }
  rpc_st_plan_people({ p_plans }) {
    const u = this.sessionUser; const out = {};
    for (const pid of p_plans || []) {
      const ms = this.planMembers.filter((m) => m.plan === pid);
      out[pid] = { count: ms.length, names: u ? ms.filter((m) => m.showName && m.user !== u && !this._excluded(u, m.user)).map((m) => this.profiles.get(m.user)?.firstName).filter(Boolean) : [], mine: Boolean(u) && ms.some((m) => m.user === u) };
    }
    return out;
  }

  rpc_st_meet_propose({ p_chat, p_kind, p_plan = null, p_place = null, p_at = null }) {
    const u = this._uid(); const c = this._chatOf(p_chat, u);
    if (!['plan', 'place', 'standing'].includes(p_kind)) throw err('bad_meet');
    const m = { id: uid('meet'), chat: c.id, proposer: u, kind: p_kind, planId: p_plan, place: p_place ? { name: clean(p_place.name, 60), neighborhood: p_place.neighborhood, why: clean(p_place.why, 80) } : null, at: p_at, status: 'proposed', after: {}, createdAt: iso(this.now()) };
    this.meets.push(m); c.lastAt = m.createdAt; this._changed(c.id);
    const other = c.a === u ? c.b : c.a; const p = this.profiles.get(other);
    if (p?.demoAccepts) setTimeout(() => { m.status = 'accepted'; for (const id of [c.a, c.b]) { const pp = this.profiles.get(id); if (pp) pp.confirmed++; } this._changed(c.id); }, 1500);
    return { id: m.id };
  }
  rpc_st_meet_respond({ p_meet, p_accept }) {
    const u = this._uid(); const m = this.meets.find((x) => x.id === p_meet); if (!m) throw err('not_found');
    const c = this._chatOf(m.chat, u); if (m.proposer === u || m.status !== 'proposed') throw err('not_found');
    m.status = p_accept ? 'accepted' : 'declined';
    if (p_accept) for (const id of [c.a, c.b]) { const p = this.profiles.get(id); if (p) p.confirmed++; }
    c.lastAt = iso(this.now()); this._changed(c.id);
    return { status: m.status };
  }
  rpc_st_after({ p_meet, p_verdict }) {
    const u = this._uid(); if (!['good', 'fine', 'report'].includes(p_verdict)) throw err('bad_after');
    const m = this.meets.find((x) => x.id === p_meet); if (!m || !['accepted', 'done'].includes(m.status)) throw err('not_found');
    const c = this._chatOf(m.chat, u); const other = c.a === u ? c.b : c.a;
    if (m.after[u]) return;
    m.after[u] = p_verdict; m.status = 'done';
    if (p_verdict !== 'report') { const p = this.profiles.get(other); if (p) p.showed++; }
    else { this.reports.push({ id: uid('r'), from: u, about: other, reason: 'unsafe', detail: 'after-meet check-in', ref: `meet:${m.id}`, createdAt: iso(this.now()), resolvedAt: null }); this._applyReports(other); }
  }

  rpc_st_block({ p_other, p_kind = 'block' }) {
    const u = this._uid(); this.blocks.set(`${u}|${p_other}`, p_kind === 'hide' ? 'hide' : 'block');
    for (const h of this.hellos) if ((h.from === u && h.to === p_other) || (h.from === p_other && h.to === u)) h.status = 'passed';
  }
  rpc_st_unblock({ p_other }) { this.blocks.delete(`${this._uid()}|${p_other}`); }
  rpc_st_report({ p_about, p_reason, p_detail = '', p_ref = '' }) {
    const u = this._uid();
    if (!['fake', 'harassment', 'unsafe', 'minor', 'other'].includes(p_reason) || p_about === u) throw err('bad_report');
    if (this.reports.filter((r) => r.from === u && new Date(r.createdAt) > this.now() - DAY).length >= RATE.reportsPerDay) throw err('slow_down');
    this.reports.push({ id: uid('r'), from: u, about: p_about, reason: p_reason, detail: clean(p_detail, 500), ref: p_ref, createdAt: iso(this.now()), resolvedAt: null });
    if (p_reason === 'minor') { const p = this.profiles.get(p_about); if (p) p.suppressed = true; }
    this._applyReports(p_about);
    this.rpc_st_block({ p_other: p_about, p_kind: 'block' });
  }
  rpc_st_push_save() {}
  rpc_st_push_remove() {}
  rpc_st_delete_me() {
    const u = this._uid();
    this.chats = this.chats.filter((c) => c.a !== u && c.b !== u);
    this.messages = this.messages.filter((m) => this.chats.some((c) => c.id === m.chat));
    this.profiles.delete(u); this.intents.delete(u); this.photos.delete(u); this.users.delete(u);
    this.hellos = this.hellos.filter((h) => h.from !== u && h.to !== u);
    this.planMembers = this.planMembers.filter((m) => m.user !== u);
    this.signOut();
  }

  rpc_st_mod_queue() {
    const u = this._uid(); if (!this._isMod(u)) throw err('not_mod');
    const who = (id) => { const p = this.profiles.get(id); return p ? { id, firstName: p.firstName } : null; };
    return {
      reports: this.reports.filter((r) => !r.resolvedAt).map((r) => ({ id: r.id, reason: r.reason, detail: r.detail, ref: r.ref, createdAt: r.createdAt, about: { ...who(r.about), reports: this.profiles.get(r.about)?.reports ?? 0, suppressed: this.profiles.get(r.about)?.suppressed ?? false, banned: false }, from: who(r.from) })),
      held: this.messages.filter((m) => m.held).map((m) => ({ id: m.id, body: m.body, createdAt: m.at, chatId: m.chat, from: who(m.from) })),
      suppressed: [...this.profiles.values()].filter((p) => p.suppressed && !p.banned).map((p) => ({ id: p.id, firstName: p.firstName, reports: p.reports, createdAt: p.createdAt })),
      ratio: this.rpc_st_mod_ratio(),
    };
  }
  rpc_st_mod_ratio() {
    const u = this._uid(); if (!this._isMod(u)) throw err('not_mod');
    const by = {}; for (const [id, i] of this.intents) if (i.datingOpen && this.profiles.has(id)) by[i.gender] = (by[i.gender] || 0) + 1;
    return { members: this.profiles.size, datingOpen: by, datingHis7d: {}, datingReplied7d: {} };
  }
  rpc_st_mod_act({ p_kind, p_id, p_action }) {
    const u = this._uid(); if (!this._isMod(u)) throw err('not_mod');
    if (p_kind === 'report') { const r = this.reports.find((x) => x.id === p_id); if (r) { r.resolvedAt = iso(this.now()); this._applyReports(r.about); } }
    else if (p_kind === 'profile') {
      const p = this.profiles.get(p_id); if (!p) return;
      if (p_action === 'restore') { p.suppressed = false; p.reports = 0; for (const r of this.reports) if (r.about === p_id && !r.resolvedAt) r.resolvedAt = iso(this.now()); }
      else if (p_action === 'suppress') p.suppressed = true;
      else if (p_action === 'ban') { p.banned = true; p.suppressed = true; for (const r of this.reports) if (r.about === p_id && !r.resolvedAt) r.resolvedAt = iso(this.now()); }
    } else if (p_kind === 'message') {
      const m = this.messages.find((x) => x.id === p_id); if (!m) return;
      if (p_action === 'release') m.held = false; else if (p_action === 'delete') this.messages.splice(this.messages.indexOf(m), 1);
    }
  }
}

// ------------------------------------------------------------- seed

function gradientFor(seed) {
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = h % 360, b = (a + 40) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='750'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a},35%,72%)'/><stop offset='1' stop-color='hsl(${b},30%,50%)'/></linearGradient></defs><rect width='600' height='750' fill='url(#g)'/><circle cx='300' cy='300' r='110' fill='rgba(255,255,255,.55)'/><rect x='120' y='440' width='360' height='230' rx='120' fill='rgba(255,255,255,.45)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function seedDemo(fb) {
  const t = fb.now();
  const cast = [
    ['Maya', 1995, 'one', ['trails', 'music'], [['weekend', 'Camel’s Hump in any weather except wind, then Radio Bean'], ['send', 'The bench at the end of the North Beach breakwater']], { datingOpen: true, gender: 'woman', seeking: ['man', 'nonbinary'] }, ['Mansfield in sideways rain, 2024. Zero regrets, one lost hat.', 'Okay but do you actually go out when it’s raining or is that a bit', 'Thursday works. I’ll be the one in the wrong jacket.'], 'The hill behind the Intervale farms at dusk, nobody’s ever there', true],
    ['Jonah', 1990, 'downtown', ['games', 'music'], [['order', 'Dobra, the monk’s blend, every time'], ['teach', 'How to lose at cribbage gracefully']], { datingOpen: true, gender: 'man', seeking: ['woman'] }, ['ha. I knew someone would call that out', 'Cribbage rematch at Foam?'], 'Battery Park at 6am before the tourists', true],
    ['Priya', 1993, 'south-end', ['dogs', 'trails'], [['lately', 'Teaching my rescue mutt to stop eating sticks'], ['weather', 'Anything above ten degrees, honestly']], { datingOpen: false, gender: null, seeking: [] }, ['She’s part lab part chaos', 'Oakledge Saturday? She needs friends more than I do'], 'The dog beach at Oakledge when the light goes sideways', true],
    ['Theo', 1988, 'winooski', ['music'], [['argue', 'Higher Ground sounds better from the back'], ['next', 'The Thursday jazz thing at Leunig’s']], { datingOpen: true, gender: 'man', seeking: ['woman', 'man'] }, ['fair', 'going to the show thursday if you want a second'], 'Mount Philo in October', true],
    ['Rosa', 1997, 'hill', ['games', 'trails'], [['weekend', 'Farmers market, then a trail, then nothing'], ['teach', 'Euchre, properly']], { datingOpen: true, gender: 'woman', seeking: ['woman'] }, ['yes to all of it'], 'Rock Point, the far side', true],
    ['Dev', 1991, 'new-north-end', ['dogs'], [['lately', 'Getting the dog to swim at Leddy'], ['order', 'Creemee. Maple. Always.']], { datingOpen: false, gender: null, seeking: [] }, ['Leddy beach dog walk sunday?'], 'Ethan Allen tower at dusk', true],
    ['Hana', 1994, 'south-burlington', ['trails', 'games'], [['weather', 'I have skis. That’s my answer.'], ['send', 'Shelburne Farms when it’s empty']], { datingOpen: true, gender: 'woman', seeking: ['man'] }, ['ok that’s a good one', 'sure — sunday afternoon?'], 'The Bolton backcountry on a weekday', true],
    ['Marcus', 1986, 'south-end', ['music', 'games'], [['argue', 'Pine Street is the real main street'], ['next', 'A board game night that isn’t Catan']], { datingOpen: true, gender: 'man', seeking: ['woman'] }, ['haha agreed', 'Thursday then'], 'The South End art hop after-hours', true],
    ['Lena', 1992, 'essex', ['dogs', 'music'], [['lately', 'Two shows a week, minimum'], ['teach', 'How to get a dog into Higher Ground (you can’t)']], { datingOpen: true, gender: 'woman', seeking: ['woman', 'man', 'nonbinary'] }, ['lol', 'what are you doing saturday'], 'The pavilion at the end of the bike path', true],
    ['Stephen', 1992, 'south-end', ['games'], [['weekend', 'Coffee with thirty people, then a long walk'], ['argue', 'Creemees beat ice cream and it isn’t close']], { datingOpen: false, gender: null, seeking: [] }, ['see you Saturday'], 'The top of the parking garage at sunset', false],
  ];
  cast.forEach(([name, y, hood, tabs, prompts, intent, demoReplies, demoCardAnswer, demoAccepts], i) => {
    const id = `seed-${String(i + 1).padStart(4, '0')}-0000-0000-000000000000`;
    fb.users.set(id, { email: name === 'Stephen' ? 'stephenvdavis@gmail.com' : `${name.toLowerCase()}@example.com` });
    fb.profiles.set(id, { id, firstName: name, birthYear: y, neighborhood: hood, tabs, prompts: prompts.map(([pid, a]) => ({ id: pid, a })), visible: true, suppressed: false, banned: false, reports: 0, confirmed: 0, showed: 0, createdAt: iso(t - (i + 1) * 3 * DAY), demoReplies, demoCardAnswer, demoAccepts });
    fb.intents.set(id, intent);
    fb.uploadPhoto(id, 0); if (i % 2) fb.uploadPhoto(id, 1);
  });
  // a few people are already going to plans (plan context on cards)
  fb.planMembers.push({ plan: 'demo:music-thu', user: 'seed-0001-0000-0000-000000000000', showName: true });
  fb.planMembers.push({ plan: 'demo:music-thu', user: 'seed-0004-0000-0000-000000000000', showName: true });
  fb.planMembers.push({ plan: 'demo:dogs-sat', user: 'seed-0003-0000-0000-000000000000', showName: true });
  fb.planMembers.push({ plan: 'demo:games-sun', user: 'seed-0002-0000-0000-000000000000', showName: false });
  // an Up For It plan that's on (dated) and one still tipping (must never show)
  fb.ufPlans = [
    { id: 'uf-1', title: 'Beginner pickleball, Leddy courts', place: 'Leddy Park', category: 'sports', starts_at: iso(t + 3 * DAY + 10 * 3600e3), cap: 12, threshold: 6, status: 'on', host_name: 'Jonathon', in_count: 7, meetup_url: 'https://www.meetup.com/' },
    { id: 'uf-2', title: 'Book swap + cider', place: 'Somewhere on Pine St', category: 'words', starts_at: null, cap: 10, threshold: 5, status: 'tipping', host_name: null, in_count: 3, meetup_url: '' },
  ];
  // the demo: once you've made a profile, two people have already said hi
  fb.afterFirstProfile = (u) => {
    fb.hellos.push({ id: uid('hi'), from: 'seed-0003-0000-0000-000000000000', to: u, lane: 'friends', note: 'My dog needs friends more than I do — Oakledge Saturday?', status: 'open', createdAt: iso(fb.now() - 3600e3), expiresAt: iso(fb.now() + 6 * DAY) });
    fb.hellos.push({ id: uid('hi'), from: 'seed-0001-0000-0000-000000000000', to: u, lane: 'friends', note: 'Saw you like trails. Camel’s Hump in the rain: yes or no?', status: 'open', createdAt: iso(fb.now() - 7200e3), expiresAt: iso(fb.now() + 6 * DAY) });
  };
  // events-sourced plans (what data/plans.json supplies in production)
  const next = (dow, hour) => { const d = new Date(t); d.setHours(hour, 0, 0, 0); while (d.getDay() !== dow || d.getTime() < t) d.setDate(d.getDate() + 1); return d.toISOString(); };
  fb.demoPlans = [
    { id: 'demo:music-thu', title: 'Kat Wright', place: 'Higher Ground', neighborhood: 'South Burlington', startsAt: next(4, 20), endsAt: null, tab: 'music', cap: null, going: 0, host: null, url: 'https://highergroundmusic.com/', source: 'events', status: 'dated' },
    { id: 'demo:dogs-sat', title: 'Oakledge dog walk', place: 'Oakledge Park', neighborhood: 'South End', startsAt: next(6, 9), endsAt: null, tab: 'dogs', cap: null, going: 0, host: null, url: null, source: 'events', status: 'dated' },
    { id: 'demo:games-sun', title: 'Cribbage and cards', place: 'Dobra Tea', neighborhood: 'Downtown', startsAt: next(0, 15), endsAt: null, tab: 'games', cap: 8, going: 0, host: null, url: null, source: 'events', status: 'dated' },
    { id: 'demo:trails-sun', title: 'Mount Philo sunrise walk', place: 'Mount Philo State Park', neighborhood: 'Charlotte', startsAt: next(0, 6), endsAt: null, tab: 'trails', cap: null, going: 0, host: null, url: null, source: 'events', status: 'dated' },
    { id: 'demo:coffee-sat', title: 'Saturday coffee (the usual crowd)', place: 'Downtown', neighborhood: 'Downtown', startsAt: next(6, 10), endsAt: null, tab: null, cap: null, going: 0, host: 'Stephen', url: 'https://www.meetup.com/', source: 'standing', status: 'dated' },
  ];
  return fb;
}

export { DEMO_UID };
