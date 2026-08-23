// SMALL TALK — UI. Plain ES module, no build step. Everything that is a rule
// lives in js/core.js; everything that talks to a server lives in js/net.js.

import {
  APP_NAME, NEIGHBORHOODS, TABS, PROMPTS, GENDERS, LIMITS, SELF_PROMPTS,
  validateProfile, validateIntent, validateHi, validateMessage, pickQuestion,
  upcomingPlans, meetOptions, tabLabel, hoodLabel, fmtWhen,
} from './core.js';
import { backend, fetchPlans, explain, isDemo, kickNotify, NetError } from './net.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const now = () => Date.now();

const api = backend();
const state = {
  session: null, me: null, tab: 'people', lane: 'friends', tabFilter: null,
  deck: null, plans: null, plansTab: null, planPeople: {}, inbox: null, chat: null, chatUnsub: null,
  places: null, questions: null, urls: {}, onb: null, busy: false,
};

// ------------------------------------------------------------- boot

async function boot() {
  try { state.places = await (await fetch(new URL('data/places.json', document.baseURI))).json(); } catch { state.places = { places: [], standing: null }; }
  try { state.questions = (await (await fetch(new URL('data/questions.json', document.baseURI))).json()).questions; } catch { state.questions = []; }
  if ('serviceWorker' in navigator && !isDemo()) navigator.serviceWorker.register('sw.js').catch(() => {});
  const measure = () => document.documentElement.style.setProperty('--topbar', `${$('#top').offsetHeight}px`);
  measure(); window.addEventListener('resize', measure);
  $$('#tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#sheet-host').addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  await api.onAuth((s) => { state.session = s; onSession(); });
  state.session = await api.session();
  await onSession();
}

let sessionToken = 0;
async function onSession() {
  const my = ++sessionToken;
  state.me = null; state.deck = null; state.inbox = null;
  if (!state.session) { renderTop(); renderLanding(); return; }
  try {
    state.me = await api.rpc('st_me');
  } catch (e) {
    if (my !== sessionToken) return;
    renderTop(); renderError(e); return;
  }
  if (my !== sessionToken) return;
  renderTop();
  if (!state.me.profile) { state.onb = state.onb || { step: 1, draft: { tabs: [], prompts: [] }, intent: { datingOpen: false, seeking: [] }, photos: {} }; renderOnboarding(); return; }
  if (state.chat) { renderChat(); return; }
  go(state.tab || 'people');
}

function renderTop() {
  const r = $('#top-right'); r.innerHTML = '';
  if (isDemo()) r.append(h('<span class="tag rose">demo — nothing saves</span>'));
  if (state.me?.isMod) r.append(h('<a class="btn sm quiet" href="mod.html">Back room</a>'));
}

function go(tab) {
  state.tab = tab; state.chat = null; unsubChat();
  $$('#tabbar button').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $('#tabbar').hidden = false; document.body.classList.remove('no-tabbar');
  window.scrollTo(0, 0);
  ({ people: renderPeople, plans: renderPlans, inbox: renderInbox, me: renderMe })[tab]();
}

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function fail(e) { console.warn(e); toast(explain(e)); }
// a non-button element that acts like one: reachable by keyboard, announced as a button
function pressable(el, fn, label) {
  if (!el) return;
  el.setAttribute('role', 'button'); el.tabIndex = 0; if (label) el.setAttribute('aria-label', label);
  el.addEventListener('click', fn);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } });
}

function openSheet(node) { const s = $('#sheet'); s.innerHTML = ''; s.append(node); $('#sheet-host').hidden = false; const f = s.querySelector('textarea, input, button.primary, button'); if (f) setTimeout(() => f.focus(), 30); }
function closeSheet() { $('#sheet-host').hidden = true; $('#sheet').innerHTML = ''; }

// signed URLs live an hour; re-sign anything older than 50 minutes so a long-open tab keeps its pictures
async function photoUrls(paths) {
  const t = now();
  const need = paths.filter((p) => !state.urls[p] || t - state.urls[p].at > 50 * 60 * 1000);
  if (need.length) { const got = await api.photoUrls(need); for (const [k, u] of Object.entries(got)) state.urls[k] = { u, at: t }; }
  return paths.map((p) => state.urls[p]?.u).filter(Boolean);
}

// ------------------------------------------------------------- landing (signed out)

async function renderLanding() {
  $('#tabbar').hidden = true; document.body.classList.add('no-tabbar');
  const main = $('#main');
  main.innerHTML = '';
  const v = h(`<div class="stack">
    <section class="hero">
      <h1>Meet people here. Friends, or more.</h1>
      <p class="lede">A Burlington-only way to meet people you could actually run into — one line instead of an opener, a question card when you're stuck, and real plans in town.</p>
      <div class="row wrap" style="margin-top:14px">
        <button class="btn primary" id="b-google"><svg class="g" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"/><path fill="currentColor" opacity=".8" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="currentColor" opacity=".6" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="currentColor" opacity=".9" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6Z"/></svg>Continue with Google</button>
        <button class="btn" id="b-email">Email me a link</button>
      </div>
      <p class="small muted">Adults (18+) in Chittenden County. Nothing is posted anywhere; nobody outside the app can see you.</p>
    </section>
    <section class="keep"><b>What we keep / what we don't</b>
      <ul>
        <li>Keep: first name, birth year, neighborhood, your prompts, 1–3 photos, the email you signed in with.</li>
        <li>Don't: phone number, last name, exact location, photos in chat, trackers, ads.</li>
        <li>"Open to dating" is private — it routes who you see, it never shows on your card.</li>
        <li>Delete everything is one tap. It really deletes.</li>
      </ul>
    </section>
    <section id="land-people"></section>
    <section id="land-plans"></section>
    <p class="small muted">Run by <a href="about.html">Stephen, who writes the Btown Brief</a>. Here's <a href="about.html#see">exactly what he can and can't see</a>.</p>
  </div>`);
  main.append(v);
  $('#b-google').addEventListener('click', () => api.signInGoogle().catch(fail));
  $('#b-email').addEventListener('click', () => emailSheet());
  // members: anonymized fragments, never names or photos before sign-in
  try {
    const s = await api.rpc('st_public_stats');
    const box = $('#land-people');
    box.innerHTML = `<h3>${s.members} ${s.members === 1 ? 'person' : 'people'} here so far</h3><div class="frag" style="margin-top:8px">${s.fragments.map((f) => `<span>Someone in ${esc(hoodLabel(f.neighborhood))}${f.tabs?.length ? ' · ' + f.tabs.map(tabLabel).join(', ').toLowerCase() : ''}</span>`).join('')}</div><p class="small muted">Names and photos are for members with a profile only.</p>`;
  } catch { /* not switched on yet: say nothing */ }
  try {
    const plans = upcomingPlans(await fetchPlans(), now(), 10).slice(0, 6);
    if (plans.length) {
      const box = $('#land-plans');
      box.innerHTML = `<div class="section-h"><h3>This week's plans</h3><span class="small muted">a place and a time</span></div><div class="plan-list">${plans.map((p) => planRow(p, { readOnly: true })).join('')}</div>`;
    }
  } catch { /* fine */ }
}

function emailSheet() {
  const v = h(`<div class="stack">
    <h2>Email me a sign-in link</h2>
    <p class="small muted">No password. The link signs you in on this device.</p>
    <label class="f">Email<input type="email" id="em" autocomplete="email" inputmode="email" placeholder="you@example.com"></label>
    <button class="btn primary block" id="em-go">Send the link</button>
  </div>`);
  openSheet(v);
  $('#em-go', v).addEventListener('click', async () => {
    const email = $('#em', v).value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('That email doesn’t look right.'); return; }
    try { await api.signInEmail(email); closeSheet(); toast('Check your email for the link.', 5000); } catch (e) { fail(e); }
  });
}

function renderError(e) {
  $('#tabbar').hidden = true;
  $('#main').innerHTML = `<div class="empty"><h3>Hmm.</h3><p>${esc(explain(e))}</p><button class="btn" id="retry">Try again</button> <button class="btn quiet" id="out">Sign out</button></div>`;
  $('#retry').addEventListener('click', onSession);
  $('#out').addEventListener('click', () => api.signOut());
}

// ------------------------------------------------------------- onboarding

function renderOnboarding() {
  $('#tabbar').hidden = true; document.body.classList.add('no-tabbar');
  const o = state.onb; const main = $('#main'); main.innerHTML = '';
  const head = (n, title) => `<div class="onb-head"><h2>${title}</h2><span class="step">Step ${n} of 4</span></div>`;
  if (o.step === 1) {
    main.append(h(`<div class="stack">${head(1, 'Before we start')}
      <section class="keep"><b>What we keep / what we don't</b><ul>
        <li>Keep: first name, birth year, neighborhood, your prompts, 1–3 photos, your sign-in email.</li>
        <li>Don't: phone, last name, exact location, photos in chat, trackers, ads.</li>
        <li>Cards and nudges are allowed here. Everyone has them.</li>
        <li>Be 18+. Be a real person. Block and report work, and a human looks.</li></ul></section>
      <button class="btn primary block" id="n">I'm in</button>
      <button class="btn quiet block" id="out">Sign out</button></div>`));
    $('#n').addEventListener('click', () => { o.step = 2; renderOnboarding(); });
    $('#out').addEventListener('click', () => api.signOut());
    return;
  }
  if (o.step === 2) {
    const d = o.draft;
    const v = h(`<div class="stack">${head(2, 'You, briefly')}
      <div class="photos" id="photos"></div><p class="small muted">One photo at least, three at most. We strip location data from photos. Photos are visible only to members with a profile of their own, never to anyone you've blocked or hidden. New photos get an automatic check.</p>
      <label class="f">First name<input type="text" id="fn" maxlength="24" autocomplete="given-name" value="${esc(d.firstName ?? '')}"></label>
      <label class="f">Birth year <span class="muted">(we never store a full date)</span><input type="number" id="by" inputmode="numeric" min="1900" max="2010" placeholder="1994" value="${esc(d.birthYear ?? '')}"></label>
      <label class="f">Neighborhood<select id="hood"><option value="">Pick one</option>${NEIGHBORHOODS.map((n) => `<option value="${n.id}" ${d.neighborhood === n.id ? 'selected' : ''}>${esc(n.label)}</option>`).join('')}</select></label>
      <div class="err" id="e2"></div>
      <button class="btn primary block" id="n">Next</button></div>`);
    main.append(v); renderPhotoSlots();
    $('#n').addEventListener('click', () => {
      d.firstName = $('#fn').value; d.birthYear = $('#by').value; d.neighborhood = $('#hood').value; d.photoCount = Object.keys(o.photos).length;
      const r = validateProfile({ ...d, prompts: [{ id: 'weekend', a: 'x' }, { id: 'lately', a: 'x' }] }, now());
      if (!r.ok) { $('#e2').textContent = Object.values(r.errors).filter((m) => !/prompt/i.test(m)).join(' ') || ''; if ($('#e2').textContent) return; }
      o.step = 3; renderOnboarding();
    });
    return;
  }
  if (o.step === 3) {
    const d = o.draft;
    const v = h(`<div class="stack">${head(3, 'In your own words')}
      <p class="small muted">Answer two (up to three). Short is fine. These are the whole opener for someone else.</p>
      <div class="stack" id="pr">${PROMPTS.map((p) => { const cur = d.prompts.find((x) => x.id === p.id); return `<label class="f">${esc(p.q)}<textarea class="f" data-pid="${p.id}" maxlength="140" rows="2">${esc(cur?.a ?? '')}</textarea></label>`; }).join('')}</div>
      <h3>What would you actually do?</h3><p class="small muted">Pick any. These are the only filter in the app.</p>
      <div class="chips" id="tabs">${TABS.map((t) => `<button class="chip ${d.tabs.includes(t.id) ? 'on' : ''}" data-t="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div>
      <div class="err" id="e3"></div>
      <div class="row"><button class="btn" id="b">Back</button><button class="btn primary" id="n" style="flex:1">Next</button></div></div>`);
    main.append(v);
    $$('#tabs .chip').forEach((c) => c.addEventListener('click', () => { const t = c.dataset.t; if (d.tabs.includes(t)) d.tabs = d.tabs.filter((x) => x !== t); else d.tabs.push(t); c.classList.toggle('on'); }));
    $('#b').addEventListener('click', () => { o.step = 2; renderOnboarding(); });
    $('#n').addEventListener('click', () => {
      d.prompts = $$('#pr textarea').map((t) => ({ id: t.dataset.pid, a: t.value })).filter((p) => p.a.trim());
      const r = validateProfile({ ...d, photoCount: Object.keys(o.photos).length }, now());
      if (!r.ok) { $('#e3').textContent = Object.values(r.errors).join(' '); return; }
      o.step = 4; renderOnboarding();
    });
    return;
  }
  // step 4: lanes
  const i = o.intent;
  const v = h(`<div class="stack">${head(4, 'Lanes')}
    <p>Friends is on for everyone. <b>Open to dating</b> is private: it routes who you see, it never shows on your card, and only other people who are open see you that way.</p>
    <label class="toggle"><span><b>Open to dating</b><br><span class="small muted">Private. Change it any time in Me.</span></span><input type="checkbox" id="dopen" ${i.datingOpen ? 'checked' : ''}></label>
    <div id="dfields" ${i.datingOpen ? '' : 'hidden'} class="stack">
      <label class="f">I am<select id="gender"><option value="">Pick one</option>${GENDERS.map((g) => `<option value="${g}" ${i.gender === g ? 'selected' : ''}>${g === 'nonbinary' ? 'Non-binary' : g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></label>
      <div class="f">Open to meeting<div class="chips" id="seek">${GENDERS.map((g) => `<button class="chip ${i.seeking.includes(g) ? 'on' : ''}" data-g="${g}">${g === 'nonbinary' ? 'Non-binary people' : g === 'woman' ? 'Women' : 'Men'}</button>`).join('')}</div></div>
      <p class="small muted">Asked only for the dating lane. Never shown to anyone.</p>
    </div>
    <div class="err" id="e4"></div>
    <div class="row"><button class="btn" id="b">Back</button><button class="btn primary" id="n" style="flex:1">Start browsing</button></div></div>`);
  $('#main').append(v);
  $('#dopen').addEventListener('change', (e) => { i.datingOpen = e.target.checked; $('#dfields').hidden = !i.datingOpen; });
  $$('#seek .chip').forEach((c) => c.addEventListener('click', () => { const g = c.dataset.g; if (i.seeking.includes(g)) i.seeking = i.seeking.filter((x) => x !== g); else i.seeking.push(g); c.classList.toggle('on'); }));
  $('#b').addEventListener('click', () => { o.step = 3; renderOnboarding(); });
  $('#n').addEventListener('click', async () => {
    i.gender = $('#gender').value || null;
    const ri = validateIntent(i); if (!ri.ok) { $('#e4').textContent = Object.values(ri.errors).join(' '); return; }
    const rp = validateProfile({ ...o.draft, photoCount: Object.keys(o.photos).length }, now()); if (!rp.ok) { $('#e4').textContent = Object.values(rp.errors).join(' '); return; }
    try {
      state.me = await api.rpc('st_save_profile', { p: rp.profile });
      state.me = await api.rpc('st_set_intent', { p: ri.intent });
      state.onb = null; state.tab = 'people';
      go('people');
      setTimeout(a2hsHint, 800);
    } catch (e) { fail(e); }
  });
}

function renderPhotoSlots() {
  const box = $('#photos'); if (!box) return;
  box.innerHTML = '';
  const photos = state.onb ? state.onb.photos : Object.fromEntries((state.me?.profile?.photosAll || []).map((p) => [p.idx, p.path]));
  for (let idx = 0; idx < LIMITS.photosMax; idx++) {
    const path = photos[idx];
    const canRemove = path && (state.onb || Object.keys(photos).length > 1);   // a live profile keeps at least one photo
    const slot = h(`<div class="slot" data-idx="${idx}">${path ? `<img alt="Photo ${idx + 1}">` : '<span>+</span>'}<input type="file" accept="image/*" aria-label="Photo ${idx + 1}">${canRemove ? '<button class="x" aria-label="Remove photo">×</button>' : ''}</div>`);
    if (path) photoUrls([path]).then(([u]) => { const img = $('img', slot); if (img && u) img.src = u; });
    $('input', slot).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        toast('Uploading…', 8000);
        const blob = await shrink(f);
        const p = await api.uploadPhoto(state.me.id, idx, blob);
        delete state.urls[p];
        if (state.onb) state.onb.photos[idx] = p; else state.me = await api.rpc('st_me');
        toast('Added.'); renderPhotoSlots();
      } catch (err) { fail(err); }
    });
    const x = $('.x', slot);
    if (x) x.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await api.removePhoto(state.me.id, idx); if (state.onb) delete state.onb.photos[idx]; else state.me = await api.rpc('st_me'); renderPhotoSlots(); } catch (err) { fail(err); }
    });
    box.append(slot);
  }
}

// Re-encode to JPEG ≤1200px. Strips EXIF (including GPS) by construction.
async function shrink(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
  const max = 1200, w = bmp.width, hh = bmp.height, s = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(hh * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.85));
}

function a2hsHint() {
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;
  try { if (localStorage.getItem('st-a2hs')) return; localStorage.setItem('st-a2hs', '1'); } catch { /* fine */ }
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  openSheet(h(`<div class="stack"><h2>Add it to your Home Screen</h2>
    <p>Then a new hi or a plan can reach you as a notification. Email always comes too.</p>
    <ol class="steps">${ios ? '<li>Tap the Share button (the square with an arrow).</li><li>Tap <b>Add to Home Screen</b>.</li>' : '<li>Open the browser menu (⋮).</li><li>Tap <b>Add to Home screen</b> / <b>Install</b>.</li>'}</ol>
    <button class="btn primary block" data-close>Got it</button></div>`));
}

// ------------------------------------------------------------- people (home)

async function renderPeople() {
  const main = $('#main'); main.innerHTML = '';
  const dating = Boolean(state.me?.intent?.datingOpen);
  const v = h(`<div class="stack">
    <div class="row between">
      ${dating ? `<div class="seg" role="tablist"><button data-l="friends" class="${state.lane === 'friends' ? 'on' : ''}">Friends</button><button data-l="dating" class="${state.lane === 'dating' ? 'on' : ''}">Dating</button></div>` : '<span></span>'}
      <span class="small muted" id="lane-note"></span>
    </div>
    <div class="chips" id="tabchips"><button class="chip ${!state.tabFilter ? 'on' : ''}" data-t="">All</button>${TABS.map((t) => `<button class="chip ${state.tabFilter === t.id ? 'on' : ''}" data-t="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div>
    <div class="deck" id="deck"><div class="empty muted">Loading…</div></div>
  </div>`);
  main.append(v);
  if (!dating) state.lane = 'friends';
  $$('.seg button', v).forEach((b) => b.addEventListener('click', () => { state.lane = b.dataset.l; renderPeople(); }));
  $$('#tabchips .chip', v).forEach((c) => c.addEventListener('click', () => { state.tabFilter = c.dataset.t || null; renderPeople(); }));
  if (state.lane === 'dating') $('#lane-note').textContent = `${state.me.datingHiRemaining ?? LIMITS.datingHiPerWeek} hi's left this week`;
  try {
    const [cards, plans] = await Promise.all([api.rpc('st_browse', { p_lane: state.lane, p_tab: state.tabFilter, p_before: null }), fetchPlans()]);
    state.plans = plans;
    const deck = $('#deck'); deck.innerHTML = '';
    if (!cards.length) { renderDeckEmpty(deck); return; }
    for (const c of cards) deck.append(personCard(c, plans));
    deck.append(h(`<div class="empty small muted">That's everyone for now${state.tabFilter ? ' under ' + esc(tabLabel(state.tabFilter)) : ''}. <a href="#" id="to-plans">See this week's plans →</a></div>`));
    $('#to-plans', deck).addEventListener('click', (e) => { e.preventDefault(); go('plans'); });
  } catch (e) { $('#deck').innerHTML = `<div class="empty"><p>${esc(explain(e))}</p></div>`; }
}

function renderDeckEmpty(deck) {
  // never land on "no one new": fall through to plans
  const plans = upcomingPlans(state.plans || [], now(), 10).slice(0, 5);
  deck.innerHTML = `<div class="empty"><h3>${state.tabFilter ? `No one under ${esc(tabLabel(state.tabFilter))} yet` : state.lane === 'dating' ? 'Nobody new in the dating lane right now' : 'You’ve seen everyone for now'}</h3><p class="muted">New people show up here as they join. Meanwhile — this week's plans:</p></div>`;
  if (plans.length) { const list = h(`<div class="plan-list">${plans.map((p) => planRow(p, {})).join('')}</div>`); deck.append(list); wirePlanRows(list); }
  else deck.append(h('<p class="empty small muted">No plans in the feed yet.</p>'));
}

function personCard(c, plans) {
  const firstPrompt = c.prompts?.[0];
  const going = (c.plans || []).map((id) => (plans || []).find((p) => p.id === id)).filter(Boolean).filter((p) => new Date(p.startsAt) > now() - 3600e3)[0];
  const el = h(`<article class="pcard" data-id="${c.id}">
    <div class="photo"><img alt="" loading="lazy"><div class="dots" hidden></div></div>
    <div class="body">
      <div class="name">${esc(c.firstName)}<small>${c.age}</small></div>
      <div class="meta">${esc(hoodLabel(c.neighborhood))}${c.tabs?.length ? ' · ' + c.tabs.map((t) => esc(tabLabel(t).toLowerCase())).join(', ') : ''}</div>
      ${firstPrompt ? `<div class="prompt"><div class="q">${esc(PROMPTS.find((p) => p.id === firstPrompt.id)?.q ?? '')}</div><div class="a">${esc(firstPrompt.a)}</div></div>` : ''}
      ${going ? `<div class="plan">→ Going: ${esc(going.title)}, ${esc(fmtWhen(going.startsAt, now()))}</div>` : ''}
      ${c.hi ? `<div class="hi-sent">You said hi${c.hi.status === 'waved' || c.hi.status === 'replied' ? ' — they answered, check Inbox' : ''}.</div>` : `<div class="actions"><button class="btn" data-act="pass">Pass</button><button class="btn primary" data-act="hi">Say hi</button></div>`}
    </div>
  </article>`);
  if (c.photos?.length) {
    photoUrls(c.photos).then((urls) => {
      const img = $('img', el); if (urls[0]) img.src = urls[0];
      if (urls.length > 1) { const d = $('.dots', el); d.hidden = false; d.innerHTML = urls.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join(''); let i = 0; $('.photo', el).addEventListener('click', () => { i = (i + 1) % urls.length; img.src = urls[i]; $$('i', d).forEach((x, j) => x.classList.toggle('on', j === i)); }); }
    });
  }
  $('[data-act="pass"]', el)?.addEventListener('click', async () => { el.remove(); try { await api.rpc('st_pass', { p_other: c.id }); } catch (e) { fail(e); } if (!$('#deck .pcard')) renderDeckEmpty($('#deck')); });
  $('[data-act="hi"]', el)?.addEventListener('click', () => hiSheet(c, el));
  pressable($('.body .name', el), () => profileSheet(c, plans), `Open ${c.firstName}'s profile`);
  return el;
}

function profileSheet(c, plans) {
  const v = h(`<div class="stack">
    <h2>${esc(c.firstName)} <span class="muted" style="font-size:18px">${c.age} · ${esc(hoodLabel(c.neighborhood))}</span></h2>
    ${c.tabs?.length ? `<div class="row wrap">${c.tabs.map((t) => `<span class="tag">${esc(tabLabel(t))}</span>`).join('')}</div>` : ''}
    ${(c.prompts || []).map((p) => `<div class="pcard"><div class="body"><div class="prompt" style="margin:0"><div class="q">${esc(PROMPTS.find((x) => x.id === p.id)?.q ?? '')}</div><div class="a">${esc(p.a)}</div></div></div></div>`).join('')}
    ${(c.plans || []).map((id) => (plans || []).find((p) => p.id === id)).filter(Boolean).map((p) => `<div class="plan"><div><div class="t">${esc(p.title)}</div><div class="m">${esc(p.place)} · ${esc(fmtWhen(p.startsAt, now()))}</div></div></div>`).join('')}
    <div class="row"><button class="btn quiet" id="rep">Report</button><button class="btn quiet" id="hide">Hide me from them</button></div>
  </div>`);
  openSheet(v);
  $('#rep', v).addEventListener('click', () => reportSheet(c.id));
  $('#hide', v).addEventListener('click', async () => { try { await api.rpc('st_block', { p_other: c.id, p_kind: 'hide' }); closeSheet(); toast(`Hidden. You won't see each other.`); renderPeople(); } catch (e) { fail(e); } });
}

function hiSheet(c, cardEl) {
  const v = h(`<div class="stack">
    <h2>Say hi to ${esc(c.firstName)}</h2>
    <p class="small muted">One line. That's the whole opener. ${c.prompts?.[0] ? `They wrote: <i>“${esc(c.prompts[0].a)}”</i>` : ''}</p>
    <textarea class="f" id="hi-note" maxlength="${LIMITS.hiMax}" rows="2" placeholder="e.g. fellow any-weather hiker — worst summit you've been on?"></textarea>
    <div class="counter"><span id="cnt">0</span>/${LIMITS.hiMax}</div>
    <button class="btn primary block" id="hi-send" disabled>Send</button>
  </div>`);
  openSheet(v);
  const ta = $('#hi-note', v), btn = $('#hi-send', v);
  ta.addEventListener('input', () => { $('#cnt', v).textContent = ta.value.length; btn.disabled = !ta.value.trim(); });
  btn.addEventListener('click', async () => {
    const r = validateHi(ta.value); if (!r.ok) { toast(r.error); return; }
    btn.disabled = true;
    try {
      await api.hi(c.id, state.lane, r.note);
      kickNotify(); closeSheet(); toast('Sent. You’ll hear back in Inbox if they answer.');
      $('.actions', cardEl)?.replaceWith(h('<div class="hi-sent">You said hi.</div>'));
      if (state.lane === 'dating' && state.me) { state.me.datingHiRemaining = Math.max(0, (state.me.datingHiRemaining ?? 5) - 1); $('#lane-note').textContent = `${state.me.datingHiRemaining} hi's left this week`; }
    } catch (e) { btn.disabled = false; fail(e); }
  });
}

function reportSheet(aboutId, ref = '') {
  const v = h(`<div class="stack">
    <h2>Report</h2><p class="small muted">Stephen reads every report. Two reports from different people hide a profile from browse until he looks; a report about a minor hides it immediately. You'll be blocked from each other either way.</p>
    <div class="stack tight" id="reasons">${[['fake', 'Fake or not who they say'], ['harassment', 'Harassing or rude'], ['unsafe', 'Made me feel unsafe'], ['minor', 'Seems under 18'], ['other', 'Something else']].map(([k, l]) => `<button class="opt" data-r="${k}"><b>${l}</b></button>`).join('')}</div>
    <textarea class="f" id="rep-detail" maxlength="500" rows="2" placeholder="Anything that helps (optional)"></textarea>
    <button class="btn danger block" id="rep-go" disabled>Send report</button>
  </div>`);
  openSheet(v); let reason = null;
  $$('#reasons .opt', v).forEach((b) => b.addEventListener('click', () => { reason = b.dataset.r; $$('#reasons .opt', v).forEach((x) => x.classList.toggle('pick', x === b)); $('#rep-go', v).disabled = false; }));
  $('#rep-go', v).addEventListener('click', async () => {
    try { await api.rpc('st_report', { p_about: aboutId, p_reason: reason, p_detail: $('#rep-detail', v).value, p_ref: ref }); closeSheet(); toast('Reported. Thank you — a human will look.'); if (state.chat) go('inbox'); else renderPeople(); } catch (e) { fail(e); }
  });
}

// ------------------------------------------------------------- plans

function planRow(p, { readOnly = false } = {}) {
  const people = state.planPeople[p.id];
  const count = (people?.count ?? 0) + (p.going || 0);
  const who = people?.names?.length ? `${people.names.slice(0, 3).join(', ')}${people.names.length > 3 ? ` +${people.names.length - 3}` : ''} from here` : count ? `${count} going` : '';
  return `<div class="plan ${p.source === 'standing' ? 'standing' : ''}" data-id="${esc(p.id)}">
    <div class="t">${esc(p.title)}</div>
    <div class="m">${esc(fmtWhen(p.startsAt, now()))} · ${esc(p.place)}${p.host ? ` · hosted by ${esc(p.host)}` : ''}${p.cap ? (p.going ? ` · ${p.going}/${p.cap} seats` : ` · ${p.cap} seats`) : ''}${p.tab ? ` · ${esc(tabLabel(p.tab).toLowerCase())}` : ''}</div>
    ${who ? `<div class="who">${esc(who)}</div>` : '<div class="who"></div>'}
    ${readOnly ? (p.url ? `<a class="btn sm cta" href="${esc(p.url)}" target="_blank" rel="noopener">Details</a>` : '<span></span>') : `<button class="btn sm cta ${people?.mine ? '' : 'primary'}" data-join>${people?.mine ? "I'm in ✓" : "I'm in"}</button>`}
  </div>`;
}

function wirePlanRows(root) {
  $$('.plan [data-join]', root).forEach((b) => b.addEventListener('click', () => planSheet(b.closest('.plan').dataset.id)));
}

async function renderPlans() {
  const main = $('#main'); main.innerHTML = '<div class="empty muted">Loading plans…</div>';
  try {
    state.plans = await fetchPlans();
    const all = upcomingPlans(state.plans, now(), 10);
    const list = state.plansTab ? all.filter((p) => p.tab === state.plansTab || p.source === 'standing') : all;
    try { state.planPeople = await api.rpc('st_plan_people', { p_plans: list.map((p) => p.id) }); } catch { /* fine */ }
    // group by day; people-from-here and tabbed plans first; each day collapsed to a handful
    const days = new Map();
    for (const p of list) { const k = new Date(p.startsAt).toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(p); }
    const rank = (p) => ((state.planPeople[p.id]?.count || 0) > 0 ? 0 : p.source !== 'events' ? 1 : p.tab ? 2 : 3);
    main.innerHTML = '';
    const v = h(`<div class="stack">
      <div class="section-h"><h2>This week</h2><span class="small muted">a place and a time</span></div>
      <div class="chips" id="pchips"><button class="chip ${!state.plansTab ? 'on' : ''}" data-t="">All</button>${TABS.map((t) => `<button class="chip ${state.plansTab === t.id ? 'on' : ''}" data-t="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div>
      <div id="days" class="stack"></div>
      ${list.length ? '' : '<div class="empty"><h3>Nothing in the feed yet</h3><p class="muted">Plans come from the Btown Brief events calendar and Up For It. Check back soon.</p></div>'}
      <p class="small muted">"I'm in" tells people here you're going. Seats and RSVPs happen wherever the plan lives (the Details link) — we never reserve anything for you. Full calendar: <a href="https://guide.btownbrief.com/events.html" target="_blank" rel="noopener">guide.btownbrief.com</a>.</p>
    </div>`);
    main.append(v);
    $$('#pchips .chip', v).forEach((c) => c.addEventListener('click', () => { state.plansTab = c.dataset.t || null; renderPlans(); }));
    const CAP = 5;
    for (const [k, ps] of days) {
      ps.sort((a, b) => rank(a) - rank(b) || Date.parse(a.startsAt) - Date.parse(b.startsAt));
      const d = new Date(k), label = fmtWhen(ps[0].startsAt, now()).split(' ')[0] === 'Today' ? 'Today' : fmtWhen(ps[0].startsAt, now()).split(' ')[0] === 'Tomorrow' ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
      const sec = h(`<section><div class="section-h"><h3>${esc(label)}</h3><span class="small muted">${ps.length}</span></div><div class="plan-list">${ps.slice(0, CAP).map((p) => planRow(p)).join('')}</div>${ps.length > CAP ? `<button class="btn quiet sm" data-more>+${ps.length - CAP} more</button>` : ''}</section>`);
      $('[data-more]', sec)?.addEventListener('click', (e) => { $('.plan-list', sec).insertAdjacentHTML('beforeend', ps.slice(CAP).map((p) => planRow(p)).join('')); wirePlanRows(sec); e.target.remove(); });
      wirePlanRows(sec);
      $('#days', v).append(sec);
    }
  } catch (e) { main.innerHTML = `<div class="empty"><p>${esc(explain(e))}</p></div>`; }
}

function planSheet(id) {
  const p = (state.plans || []).find((x) => x.id === id); if (!p) return;
  const people = state.planPeople[id] || { count: 0, names: [], mine: false };
  const v = h(`<div class="stack">
    <h2>${esc(p.title)}</h2>
    <p class="muted">${esc(fmtWhen(p.startsAt, now()))} · ${esc(p.place)}${p.neighborhood ? ` · ${esc(p.neighborhood)}` : ''}${p.host ? ` · hosted by ${esc(p.host)}` : ''}</p>
    ${people.names.length ? `<p><b>From here:</b> ${esc(people.names.join(', '))}</p>` : people.count ? `<p>${people.count} from here going.</p>` : ''}
    ${p.url ? `<a class="btn block" href="${esc(p.url)}" target="_blank" rel="noopener">Details / RSVP ↗</a>` : ''}
    <label class="toggle"><span><b>Show my first name on this plan</b><br><span class="small muted">Otherwise you're just counted.</span></span><input type="checkbox" id="showname" ${people.mine ? '' : 'checked'}></label>
    ${people.mine ? '<button class="btn block" id="leave">I’m out</button>' : '<button class="btn primary block" id="join">I’m in</button>'}
  </div>`);
  openSheet(v);
  $('#join', v)?.addEventListener('click', async () => { try { await api.rpc('st_plan_join', { p_plan: id, p_show_name: $('#showname', v).checked }); closeSheet(); toast("You're in. People here can see it on your card."); state.tab === 'plans' ? renderPlans() : renderPeople(); } catch (e) { fail(e); } });
  $('#leave', v)?.addEventListener('click', async () => { try { await api.rpc('st_plan_leave', { p_plan: id }); closeSheet(); renderPlans(); } catch (e) { fail(e); } });
}

// ------------------------------------------------------------- inbox

async function renderInbox() {
  const main = $('#main'); main.innerHTML = '<div class="empty muted">Loading…</div>';
  try {
    state.inbox = await api.rpc('st_inbox');
    const { received, sent, chats } = state.inbox;
    updateBadge(received.length);
    main.innerHTML = '';
    const v = h(`<div class="stack">
      ${received.length ? `<div class="section-h"><h3>Said hi to you</h3></div><div class="inbox-list" id="recv"></div>` : ''}
      <div class="section-h"><h3>Chats</h3></div>
      ${chats.length ? '<div class="inbox-list" id="chats"></div>' : `<div class="empty"><p class="muted">${received.length ? 'Wave or reply to a hi and a chat opens here.' : 'No chats yet. Say hi to someone in People — one line is all it takes.'}</p></div>`}
      ${sent.length ? `<p class="small muted">You've said hi to ${sent.map((s) => esc(s.firstName)).join(', ')}. If they answer, it shows up here.</p>` : ''}
    </div>`);
    main.append(v);
    for (const r of received) {
      const row = h(`<div class="hi-row"><img class="avatar" alt=""><div><div class="n">${esc(r.from.firstName)} <span class="muted small">${r.from.age} · ${esc(hoodLabel(r.from.neighborhood))}</span></div><div class="note">“${esc(r.note)}”</div></div><div class="acts"><button class="btn sm" data-wave title="Wave back">👋</button><button class="btn sm primary" data-reply>Reply</button></div></div>`);
      if (r.from.photos?.[0]) photoUrls([r.from.photos[0]]).then(([u]) => { if (u) $('img', row).src = u; });
      pressable($('.n', row), () => profileSheet(r.from, state.plans), `Open ${r.from.firstName}'s profile`);
      pressable($('.note', row), () => hiReplySheet(r), 'Read and reply');
      $('[data-wave]', row).addEventListener('click', async () => { try { const { chatId } = await api.rpc('st_wave', { p_hello: r.id }); kickNotify(); badgeMinus(); openChat(chatId); } catch (e) { fail(e); } });
      $('[data-reply]', row).addEventListener('click', () => hiReplySheet(r));
      $('#recv', v).append(row);
    }
    for (const c of chats) {
      const row = h(`<button class="chat-row"><img class="avatar" alt=""><div><div class="n">${esc(c.other.firstName)}</div><div class="last">${c.last ? (c.last.fromMe ? 'You: ' : '') + esc(c.last.body) : 'Say something'}</div></div><span class="small muted">${esc(fmtWhen(c.lastAt, now()))}</span></button>`);
      if (c.other.photos?.[0]) photoUrls([c.other.photos[0]]).then(([u]) => { if (u) $('img', row).src = u; });
      row.addEventListener('click', () => openChat(c.id));
      $('#chats', v).append(row);
    }
  } catch (e) { main.innerHTML = `<div class="empty"><p>${esc(explain(e))}</p></div>`; }
}

function updateBadge(n) { const b = $('#inbox-badge'); b.hidden = !n; b.textContent = n; updateBadge.n = n; }
function badgeMinus() { updateBadge(Math.max(0, (updateBadge.n || 1) - 1)); }

function hiReplySheet(r) {
  const v = h(`<div class="stack">
    <h2>${esc(r.from.firstName)} said</h2><div class="pcard"><div class="body"><div class="prompt" style="margin:0"><div class="a">“${esc(r.note)}”</div></div></div></div>
    <textarea class="f" id="rp" rows="3" maxlength="1000" placeholder="Reply…"></textarea>
    <div class="row"><button class="btn quiet" id="pass">Not now</button><button class="btn" id="wave">👋 Wave</button><button class="btn primary" id="send" style="flex:1" disabled>Reply</button></div>
    <p class="small muted">"Not now" quietly removes it. They're never told.</p>
  </div>`);
  openSheet(v);
  const ta = $('#rp', v); ta.addEventListener('input', () => { $('#send', v).disabled = !ta.value.trim(); });
  $('#pass', v).addEventListener('click', async () => { try { await api.rpc('st_hi_pass', { p_hello: r.id }); badgeMinus(); closeSheet(); renderInbox(); } catch (e) { fail(e); } });
  $('#wave', v).addEventListener('click', async () => { try { const { chatId } = await api.rpc('st_wave', { p_hello: r.id }); kickNotify(); badgeMinus(); closeSheet(); openChat(chatId); } catch (e) { fail(e); } });
  $('#send', v).addEventListener('click', async () => { const m = validateMessage(ta.value); if (!m.ok) { toast(m.error); return; } try { const { chatId, held } = await api.reply(r.id, m.body); kickNotify(); badgeMinus(); closeSheet(); if (held) toast('Held for a quick look before it’s delivered.', 4000); openChat(chatId); } catch (e) { fail(e); } });
}

// ------------------------------------------------------------- chat

function unsubChat() { if (state.chatUnsub) { try { state.chatUnsub(); } catch { /* fine */ } state.chatUnsub = null; } }

async function openChat(chatId) {
  state.chat = chatId; unsubChat();
  await renderChat();
  state.chatUnsub = await api.subscribeChat(chatId, () => refreshChat());
}

async function renderChat() {
  const main = $('#main'); main.innerHTML = '<div class="empty muted">Loading…</div>';
  let c;
  try { c = await api.rpc('st_chat', { p_chat: state.chat, p_since: null }); } catch (e) { main.innerHTML = `<div class="empty"><p>${esc(explain(e))}</p><button class="btn" id="bk">Back</button></div>`; $('#bk').addEventListener('click', () => go('inbox')); return; }
  if (!state.plans) { try { state.plans = await fetchPlans(); } catch { state.plans = []; } }
  main.innerHTML = '';
  const v = h(`<div class="chat">
    <div class="chat-head">
      <button class="btn sm quiet" id="back" aria-label="Back to inbox">←</button>
      <img class="avatar" alt="" style="width:36px;height:36px">
      <div style="flex:1"><div class="n">${esc(c.other.firstName)}</div><div class="m">${esc(hoodLabel(c.other.neighborhood))} · ${c.lane === 'dating' ? 'dating' : 'friends'}</div></div>
      <button class="btn sm" id="meet">Ready to meet?</button>
      <button class="btn sm quiet" id="more" aria-label="More">⋯</button>
    </div>
    <div class="msgs" id="msgs"></div>
    ${c.blocked ? '<p class="empty muted small">You can’t message each other.</p>' : `<div class="compose"><textarea id="body" rows="1" placeholder="Message…" maxlength="1000" aria-label="Message"></textarea><button class="stuck" id="stuck">Stuck?</button><button class="send" id="send" disabled aria-label="Send">↑</button></div>`}
  </div>`);
  main.append(v);
  if (c.other.photos?.[0]) photoUrls([c.other.photos[0]]).then(([u]) => { if (u) $('.avatar', v).src = u; });
  $('#back', v).addEventListener('click', () => go('inbox'));
  $('.chat-head .n', v).addEventListener('click', () => profileSheet(c.other, state.plans));
  $('#meet', v).addEventListener('click', () => meetSheet(c));
  $('#more', v).addEventListener('click', () => moreSheet(c));
  paintMessages(c);
  const ta = $('#body', v), send = $('#send', v);
  if (ta) {
    ta.addEventListener('input', () => { send.disabled = !ta.value.trim(); ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !/Mobi|Android|iPhone/.test(navigator.userAgent)) { e.preventDefault(); send.click(); } });
    send.addEventListener('click', async () => {
      const m = validateMessage(ta.value); if (!m.ok) { toast(m.error); return; }
      send.disabled = true;
      try { const r = await api.send(state.chat, m.body); ta.value = ''; ta.style.height = 'auto'; if (r.held) toast('Held for a quick look before it’s delivered.', 4000); await refreshChat(); }
      catch (e) { fail(e); send.disabled = false; }
    });
    $('#stuck', v).addEventListener('click', () => stuckSheet(c));
  }
}

async function refreshChat() {
  if (!state.chat) return;
  try { const c = await api.rpc('st_chat', { p_chat: state.chat, p_since: null }); if (state.chat === c.id) paintMessages(c); } catch { /* fine */ }
}

function paintMessages(c) {
  const box = $('#msgs'); if (!box) return;
  const items = [
    ...c.messages.map((m) => ({ at: m.at, kind: 'm', m })),
    ...c.cards.map((k) => ({ at: k.at, kind: 'k', k })),
    ...c.meets.map((x) => ({ at: x.createdAt, kind: 'x', x })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const hadFocus = document.activeElement?.closest?.('.card-q textarea') ? true : false;
  box.innerHTML = '';
  if (!items.length) box.append(h(`<div class="empty small muted">Say something — or tap <b>Stuck?</b> for a card you both answer.</div>`));
  for (const it of items) {
    if (it.kind === 'm') box.append(h(`<div class="bubble ${it.m.fromMe ? 'me' : ''} ${it.m.held ? 'held' : ''}">${esc(it.m.body)}${it.m.held ? '<span class="t">held for a look — only you see this yet</span>' : ''}</div>`));
    else if (it.kind === 'k') box.append(cardNode(it.k));
    else box.append(meetNode(it.x, c));
  }
  if (hadFocus) { const t = $('.card-q textarea', box); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  if (wasBottom || items.length < 6) box.scrollTop = box.scrollHeight;
}

const cardDrafts = new Map(); // card id → in-progress answer, survives live repaints
function cardNode(k) {
  const qText = k.question || (state.questions || []).find((q) => q.id === k.questionId)?.q || 'A card from the deck';
  const el = h(`<div class="card-q"><div class="k">Card · both answer, then reveal</div><div class="q">${esc(qText)}</div>
    ${k.mine ? `<div class="ans"><b>You</b>${esc(k.mine)}</div>` : `<textarea class="f" rows="2" maxlength="280" placeholder="Your answer — they see it only after they answer too">${esc(cardDrafts.get(k.id) || '')}</textarea><div class="row" style="margin-top:6px"><button class="btn sm primary" data-ans>Lock it in</button></div>`}
    ${k.revealed ? `<div class="ans"><b>Them</b>${esc(k.theirs)}</div>` : k.mine ? '<div class="small muted" style="margin-top:6px">Waiting for their answer…</div>' : ''}
  </div>`);
  $('textarea', el)?.addEventListener('input', (e) => cardDrafts.set(k.id, e.target.value));
  $('[data-ans]', el)?.addEventListener('click', async () => {
    const a = $('textarea', el).value.trim(); if (!a) { toast('Write something first.'); return; }
    try { await api.rpc('st_card_answer', { p_card: k.id, p_answer: a }); cardDrafts.delete(k.id); await refreshChat(); } catch (e) { fail(e); }
  });
  return el;
}

function meetNode(x, c) {
  const plan = x.planId ? (state.plans || []).find((p) => p.id === x.planId) : null;
  const title = x.kind === 'plan' ? (plan ? `${plan.title} · ${plan.place}` : 'a plan') : x.kind === 'standing' ? 'Saturday coffee (the usual crowd)' : `${x.place?.name ?? 'a place'}${x.place?.neighborhood ? ' · ' + x.place.neighborhood : ''}`;
  const when = x.at ? fmtWhen(x.at, now()) : plan ? fmtWhen(plan.startsAt, now()) : '';
  const past = (x.at ? new Date(x.at) : plan ? new Date(plan.startsAt) : new Date(8640000000000000)) < new Date(now());
  const el = h(`<div class="meet-card"><div class="k">${x.mine ? 'You proposed' : `${esc(c.other.firstName)} proposed`} · ${x.status}</div><div class="t">${esc(title)}</div>${when ? `<div class="small muted">${esc(when)}</div>` : ''}
    ${x.status === 'proposed' && !x.mine ? '<div class="row" style="margin-top:8px"><button class="btn sm" data-no>Not this one</button><button class="btn sm primary" data-yes>Yes, let’s</button></div>' : ''}
    ${x.status === 'accepted' && !past ? `<div class="small muted" style="margin-top:6px">It's on. Seats and RSVPs happen at the venue or the Details link.</div>` : ''}
    ${(x.status === 'accepted' && past) || (x.status === 'done' && !x.myAfter) ? `<div style="margin-top:8px"><div class="small muted">How'd it go? (private — one tap)</div><div class="row" style="margin-top:6px"><button class="btn sm" data-after="good">Good</button><button class="btn sm" data-after="fine">Fine</button><button class="btn sm quiet" data-after="report">Report</button></div></div>` : ''}
    ${x.myAfter ? `<div class="small muted" style="margin-top:6px">You said: ${esc(x.myAfter)}. Thanks.</div>` : ''}
  </div>`);
  $('[data-yes]', el)?.addEventListener('click', async () => { try { await api.rpc('st_meet_respond', { p_meet: x.id, p_accept: true }); kickNotify(); await refreshChat(); } catch (e) { fail(e); } });
  $('[data-no]', el)?.addEventListener('click', async () => { try { await api.rpc('st_meet_respond', { p_meet: x.id, p_accept: false }); await refreshChat(); } catch (e) { fail(e); } });
  $$('[data-after]', el).forEach((b) => b.addEventListener('click', async () => {
    const v = b.dataset.after;
    try { await api.rpc('st_after', { p_meet: x.id, p_verdict: v }); if (v === 'report') { toast('Noted. Stephen will look.'); } await refreshChat(); } catch (e) { fail(e); }
  }));
  return el;
}

function stuckSheet(c) {
  const used = c.cards.map((k) => k.questionId);
  const q = pickQuestion(state.questions || [], used, `${c.id}:${c.cards.length}:${Math.floor(now() / 60000)}`);
  const self = SELF_PROMPTS[Math.floor(Math.random() * SELF_PROMPTS.length)];
  const open = c.cards.some((k) => !k.revealed);
  const v = h(`<div class="stack">
    <h2>Stuck?</h2>
    <button class="opt" id="deal" ${!q || open ? 'disabled' : ''}><b>Deal a card</b><span class="m">${open ? 'Finish the open card first.' : q ? `“${esc(q.q)}” — you both answer privately, then it reveals.` : 'No cards left!'}</span></button>
    <div class="opt"><b>Or, about you:</b><span class="m">${esc(self)}</span></div>
    <p class="small muted">Nothing here analyzes the other person. Cards and nudges are allowed; everyone has them.</p>
  </div>`);
  openSheet(v);
  $('#deal', v).addEventListener('click', async () => { try { await api.rpc('st_card_deal', { p_chat: c.id, p_question_id: q.id, p_question: q.q }); closeSheet(); await refreshChat(); } catch (e) { fail(e); } });
}

function meetSheet(c) {
  const me = { tabs: state.me.profile.tabs, planIds: state.me.profile.planIds || [] };
  const them = { tabs: c.other.tabs, planIds: c.other.plans || [] };
  const standing = state.places?.standing ? { ...state.places.standing, startsAt: nextSaturday10() } : null;
  const opts = meetOptions({ me, them, plans: state.plans || [], places: state.places?.places || [], now: now(), standing });
  const v = h(`<div class="stack">
    <h2>Ready to meet?</h2><p class="small muted">Pick one; ${esc(c.other.firstName)} says yes or not-this-one. Public places, daylight-ish, you can always bail.</p>
    <div class="stack tight" id="opts">${opts.map((o, i) => {
      if (o.kind === 'plan') return `<button class="opt" data-i="${i}"><b>Go together: ${esc(o.plan.title)}</b><span class="m">${esc(fmtWhen(o.plan.startsAt, now()))} · ${esc(o.plan.place)}${o.plan.cap ? ` · ${o.plan.going}/${o.plan.cap} seats` : ''}</span><span class="why">${esc(o.why)}</span></button>`;
      if (o.kind === 'place') return `<button class="opt" data-i="${i}"><b>${esc(o.place.name)}</b><span class="m">${esc(o.place.neighborhood)} · check hours</span><span class="why">${esc(o.why)}</span></button>`;
      return `<button class="opt" data-i="${i}"><b>${esc(o.plan.title)}</b><span class="m">${esc(fmtWhen(o.plan.startsAt, now()))} · ${esc(o.plan.place)}</span><span class="why">${esc(o.why)}</span></button>`;
    }).join('')}</div>
    <label class="f" id="when-wrap" hidden>When<input type="datetime-local" id="when"></label>
    <button class="btn primary block" id="propose" disabled>Propose</button>
  </div>`);
  openSheet(v); let pick = null;
  $$('#opts .opt', v).forEach((b) => b.addEventListener('click', () => {
    pick = opts[Number(b.dataset.i)]; $$('#opts .opt', v).forEach((x) => x.classList.toggle('pick', x === b)); $('#propose', v).disabled = false;
    const ww = $('#when-wrap', v); ww.hidden = pick.kind !== 'place';
    if (pick.kind === 'place' && !$('#when', v).value) { const d = new Date(now() + 2 * 86400e3); d.setHours(17, 0, 0, 0); $('#when', v).value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  }));
  $('#propose', v).addEventListener('click', async () => {
    if (!pick) return;
    try {
      const args = { p_chat: c.id, p_kind: pick.kind, p_plan: pick.kind === 'plan' ? pick.plan.id : pick.kind === 'standing' ? pick.plan.id : null, p_place: pick.kind === 'place' ? { name: pick.place.name, neighborhood: pick.place.neighborhood, why: pick.why } : null, p_at: pick.kind === 'place' ? new Date($('#when', v).value).toISOString() : pick.kind === 'standing' ? pick.plan.startsAt : null };
      await api.rpc('st_meet_propose', args); kickNotify(); closeSheet(); await refreshChat();
    } catch (e) { fail(e); }
  });
}

function nextSaturday10() { const d = new Date(now()); d.setHours(10, 0, 0, 0); while (d.getDay() !== 6 || d.getTime() < now()) d.setDate(d.getDate() + 1); return d.toISOString(); }

function moreSheet(c) {
  const v = h(`<div class="stack"><h2>${esc(c.other.firstName)}</h2>
    <button class="opt" id="prof"><b>See profile</b></button>
    <button class="opt" id="hide"><b>Hide me from them</b><span class="m">You stop seeing each other; the chat stays but goes quiet. Not announced.</span></button>
    <button class="opt" id="block"><b>Block</b><span class="m">Ends the chat, hides you from each other. Not announced.</span></button>
    <button class="opt" id="rep"><b>Report</b><span class="m">A human reads it. Blocks too.</span></button></div>`);
  openSheet(v);
  $('#prof', v).addEventListener('click', () => profileSheet(c.other, state.plans));
  $('#hide', v).addEventListener('click', async () => { try { await api.rpc('st_block', { p_other: c.other.id, p_kind: 'hide' }); closeSheet(); go('inbox'); } catch (e) { fail(e); } });
  $('#block', v).addEventListener('click', async () => { try { await api.rpc('st_block', { p_other: c.other.id, p_kind: 'block' }); closeSheet(); toast('Blocked.'); go('inbox'); } catch (e) { fail(e); } });
  $('#rep', v).addEventListener('click', () => reportSheet(c.other.id, `chat:${c.id}`));
}

// ------------------------------------------------------------- me

async function renderMe() {
  const main = $('#main'); main.innerHTML = '';
  const p = state.me.profile, i = state.me.intent;
  const v = h(`<div class="stack">
    <div class="me-head"><img class="avatar" alt=""><div><h2>${esc(p.firstName)} <span class="muted" style="font-size:18px">${p.age}</span></h2><div class="muted small">${esc(hoodLabel(p.neighborhood))}${p.tabs?.length ? ' · ' + p.tabs.map((t) => esc(tabLabel(t).toLowerCase())).join(', ') : ''}</div></div></div>
    ${p.suppressed ? '<div class="keep"><b>Your profile is paused</b>It was reported and is hidden from browse while a human looks. Chats still work. If that seems wrong, <a href="mailto:hello@btownbrief.com">email Stephen</a>.</div>' : ''}
    <div class="kv"><span class="k">Edit profile</span><button class="btn sm" id="edit">Edit</button></div>
    <div class="kv"><span class="k">Photos</span><button class="btn sm" id="photos-btn">Change</button></div>
    <div class="kv"><span class="k">Open to dating <span class="small muted">(private)</span></span><label class="row"><input type="checkbox" id="dopen" ${i?.datingOpen ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--teal)"></label></div>
    <div class="kv"><span class="k">Show me in browse</span><label class="row"><input type="checkbox" id="vis" ${p.visible ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--teal)"></label></div>
    <div class="kv"><span class="k">Notifications</span><button class="btn sm" id="push">Turn on</button></div>
    <div class="kv"><span class="k">About, safety, what Stephen can see</span><a class="btn sm" href="about.html">Read</a></div>
    <div class="kv"><span class="k">Sign out</span><button class="btn sm" id="out">Sign out</button></div>
    <div class="kv"><span class="k">Delete everything</span><button class="btn sm danger" id="del">Delete</button></div>
    <p class="small muted">Signed in as ${esc(state.me.email || '')}. ${isDemo() ? 'Demo mode — nothing is saved.' : ''}</p>
  </div>`);
  main.append(v);
  if (p.photos?.[0]) photoUrls([p.photos[0]]).then(([u]) => { if (u) $('.avatar', v).src = u; });
  $('#edit', v).addEventListener('click', editProfileSheet);
  $('#photos-btn', v).addEventListener('click', () => { openSheet(h('<div class="stack"><h2>Photos</h2><div class="photos" id="photos"></div><p class="small muted">Tap a slot to add or replace. One at least, three at most.</p><button class="btn block" data-close>Done</button></div>')); renderPhotoSlots(); });
  $('#dopen', v).addEventListener('change', async (e) => { if (e.target.checked) intentSheet(); else { try { state.me = await api.rpc('st_set_intent', { p: { datingOpen: false } }); toast('Dating lane off.'); } catch (err) { fail(err); } } });
  $('#vis', v).addEventListener('change', async (e) => { try { await api.rpc('st_set_visible', { v: e.target.checked }); state.me.profile.visible = e.target.checked; toast(e.target.checked ? 'You’re visible.' : 'Hidden from browse. Chats still work.'); } catch (err) { fail(err); } });
  $('#push', v).addEventListener('click', async () => { try { const r = await api.enablePush(state.me.id); toast(r.ok ? 'Notifications on.' : r.why === 'unsupported' ? 'Add to Home Screen first — then notifications work here. Email always comes.' : r.why === 'demo' ? 'Demo mode.' : 'Not allowed by the browser. Email still comes.', 4500); } catch (e) { fail(e); } });
  $('#out', v).addEventListener('click', () => api.signOut());
  $('#del', v).addEventListener('click', deleteSheet);
}

function editProfileSheet() {
  const p = state.me.profile;
  const v = h(`<div class="stack"><h2>Edit profile</h2>
    <label class="f">First name<input type="text" id="fn" maxlength="24" value="${esc(p.firstName)}"></label>
    <label class="f">Birth year<input type="number" id="by" value="${p.birthYear}"></label>
    <label class="f">Neighborhood<select id="hood">${NEIGHBORHOODS.map((n) => `<option value="${n.id}" ${p.neighborhood === n.id ? 'selected' : ''}>${esc(n.label)}</option>`).join('')}</select></label>
    <div class="chips" id="tabs">${TABS.map((t) => `<button class="chip ${p.tabs.includes(t.id) ? 'on' : ''}" data-t="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div>
    <div class="stack" id="pr">${PROMPTS.map((q) => { const cur = p.prompts.find((x) => x.id === q.id); return `<label class="f">${esc(q.q)}<textarea class="f" data-pid="${q.id}" maxlength="140" rows="2">${esc(cur?.a ?? '')}</textarea></label>`; }).join('')}</div>
    <div class="err" id="e"></div><button class="btn primary block" id="save">Save</button></div>`);
  openSheet(v); const tabs = [...p.tabs];
  $$('#tabs .chip', v).forEach((c) => c.addEventListener('click', () => { const t = c.dataset.t; const k = tabs.indexOf(t); if (k >= 0) tabs.splice(k, 1); else tabs.push(t); c.classList.toggle('on'); }));
  $('#save', v).addEventListener('click', async () => {
    const draft = { firstName: $('#fn', v).value, birthYear: $('#by', v).value, neighborhood: $('#hood', v).value, tabs, prompts: $$('#pr textarea', v).map((t) => ({ id: t.dataset.pid, a: t.value })), photoCount: Math.max(1, p.photos?.length || 0) };
    const r = validateProfile(draft, now()); if (!r.ok) { $('#e', v).textContent = Object.values(r.errors).join(' '); return; }
    try { state.me = await api.rpc('st_save_profile', { p: r.profile }); closeSheet(); toast('Saved.'); renderMe(); } catch (e) { fail(e); }
  });
}

function intentSheet() {
  const i = { datingOpen: true, gender: state.me.intent?.gender || null, seeking: [...(state.me.intent?.seeking || [])] };
  const v = h(`<div class="stack"><h2>Open to dating</h2><p class="small muted">Private. Routes who you see; never shown on your card. Five hi's a week in this lane, for everyone.</p>
    <label class="f">I am<select id="gender"><option value="">Pick one</option>${GENDERS.map((g) => `<option value="${g}" ${i.gender === g ? 'selected' : ''}>${g === 'nonbinary' ? 'Non-binary' : g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></label>
    <div class="f">Open to meeting<div class="chips" id="seek">${GENDERS.map((g) => `<button class="chip ${i.seeking.includes(g) ? 'on' : ''}" data-g="${g}">${g === 'nonbinary' ? 'Non-binary people' : g === 'woman' ? 'Women' : 'Men'}</button>`).join('')}</div></div>
    <div class="err" id="e"></div><button class="btn primary block" id="save">Turn on</button></div>`);
  openSheet(v);
  $$('#seek .chip', v).forEach((c) => c.addEventListener('click', () => { const g = c.dataset.g; const k = i.seeking.indexOf(g); if (k >= 0) i.seeking.splice(k, 1); else i.seeking.push(g); c.classList.toggle('on'); }));
  $('#save', v).addEventListener('click', async () => {
    i.gender = $('#gender', v).value || null; const r = validateIntent(i); if (!r.ok) { $('#e', v).textContent = Object.values(r.errors).join(' '); return; }
    try { state.me = await api.rpc('st_set_intent', { p: r.intent }); closeSheet(); toast('Dating lane on.'); renderMe(); } catch (e) { fail(e); }
  });
  $('#sheet-host .scrim').addEventListener('click', () => { const cb = $('#dopen'); if (cb && !state.me.intent?.datingOpen) cb.checked = false; }, { once: true });
}

function deleteSheet() {
  const v = h(`<div class="stack"><h2>Delete everything?</h2><p>Your profile, photos, his, chats, plan check-ins, and account — gone, now, for real. There's no undo.</p>
    <button class="btn danger block" id="yes">Yes, delete everything</button><button class="btn block" data-close>Keep it</button></div>`);
  openSheet(v);
  $('#yes', v).addEventListener('click', async () => {
    try { await api.removeAllPhotos(state.me.id); await api.rpc('st_delete_me'); closeSheet(); toast('Deleted. Take care.'); await api.signOut().catch(() => {}); state.session = null; onSession(); } catch (e) { fail(e); }
  });
}

// ------------------------------------------------------------- go

boot().catch((e) => { console.error(e); $('#main').innerHTML = `<div class="empty"><p>${esc(explain(e))}</p></div>`; });
export { state, NetError, APP_NAME };
