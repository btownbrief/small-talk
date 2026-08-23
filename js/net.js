// SMALL TALK — backend client. Same Supabase project as the whole Btown fleet;
// the st_* RPCs live in supabase/small-talk-SETUP.sql. Identity is Supabase
// Auth (Google, or an email magic link) — there is no device token here.
//
// Two transports behind one `backend()`:
//   network (default) — supabase-js (auth, rpc, storage, realtime)
//   ?demo=1           — js/fake-backend.js with seeded people, saves nothing
// Fail soft: missing SQL → 'not_ready'; missing edge function → the plain
// RPC; missing plans RPC → events-only plans; missing push → email only.

import { FakeBackend, seedDemo } from './fake-backend.js';
import { APP_PATH, planFromUpForIt } from './core.js';

export const SUPABASE_URL = 'https://jnouvwxomrcffqwilqkq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_RkMJQopffWlV6DSwCRkndQ_Xw6GJMf3';
const MODERATE_FN = 'st-moderate';   // optional: OpenAI moderation before a message lands
const NOTIFY_FN = 'st-notify';       // optional: drains st_notify_queue → email (+ push)
export const VAPID_PUBLIC_KEY = '';  // set after `node scripts/vapid.mjs`; empty = push off, email only
const PHOTO_BUCKET = 'st-photos';

export class NetError extends Error {
  constructor(code, detail) { super(detail ? `${code}: ${detail}` : code); this.name = 'NetError'; this.code = code; this.detail = detail; }
}

const params = () => new URLSearchParams(globalThis.location?.search ?? '');
export const isDemo = () => params().get('demo') === '1';

// ------------------------------------------------------------- network transport

let sb = null;
async function client() {
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  return sb;
}

function codeOf(err) {
  const raw = String(err?.message || err?.code || 'error');
  if (/fetch|network|Failed to fetch/i.test(raw)) return 'offline';
  if (/PGRST202|Could not find the function|404/.test(raw)) return 'not_ready';
  return raw.split(':')[0].trim().replace(/^P0001\s*/, '');
}

async function networkRpc(fn, args = {}) {
  const c = await client();
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new NetError(codeOf(error), error.details);
  return data;
}

const network = {
  kind: 'network',
  rpc: networkRpc,
  async session() { const c = await client(); return (await c.auth.getSession()).data.session; },
  async onAuth(cb) { const c = await client(); c.auth.onAuthStateChange((_e, s) => cb(s)); },
  async signInGoogle() {
    // if the Google provider isn't switched on yet, say so instead of landing on a raw error page
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
      const s = r.ok ? await r.json() : null;
      if (s && s.external && s.external.google === false) throw new NetError('google_off');
    } catch (e) { if (e instanceof NetError) throw e; /* settings unreachable: try anyway */ }
    const c = await client();
    const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + APP_PATH } });
    if (error) throw new NetError('auth_failed', error.message);
  },
  async signInEmail(email) {
    const c = await client();
    const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + APP_PATH } });
    if (error) throw new NetError(/rate/i.test(error.message) ? 'slow_down' : 'auth_failed', error.message);
  },
  async signOut() { const c = await client(); await c.auth.signOut(); },
  async uploadPhoto(uid, idx, blob) {
    const c = await client();
    const path = `${uid}/${idx}.jpg`;
    const { error } = await c.storage.from(PHOTO_BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (error) throw new NetError('upload_failed', error.message);
    await networkRpc('st_set_photo', { p_idx: idx, p_path: path, p_status: 'ok' });
    moderatePhoto(path); // best-effort, async; flagged photos are removed server-side
    return path;
  },
  async removePhoto(uid, idx) {
    const c = await client();
    await c.storage.from(PHOTO_BUCKET).remove([`${uid}/${idx}.jpg`]).catch(() => {});
    await networkRpc('st_remove_photo', { p_idx: idx });
  },
  async removeAllPhotos(uid) {
    const c = await client();
    await c.storage.from(PHOTO_BUCKET).remove([0, 1, 2].map((i) => `${uid}/${i}.jpg`)).catch(() => {});
  },
  async photoUrls(paths) {
    if (!paths?.length) return {};
    const c = await client();
    const { data } = await c.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
    const out = {};
    for (const row of data || []) if (row.signedUrl && !row.error) out[row.path] = row.signedUrl;
    return out;
  },
  async subscribeChat(chatId, onChange) {
    const c = await client();
    const ch = c.channel(`st-chat-${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'st_messages', filter: `chat_id=eq.${chatId}` }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'st_cards', filter: `chat_id=eq.${chatId}` }, () => onChange())
      .subscribe();
    return () => { try { c.removeChannel(ch); } catch { /* fine */ } };
  },
  async send(chatId, body) {
    // prefer the moderating edge function; fall back to the plain RPC if it isn't deployed
    try {
      const s = await this.session();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${MODERATE_FN}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s?.access_token ?? SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, body }),
      });
      if (res.status === 404) throw new NetError('not_ready');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) throw new NetError(data?.error || `http_${res.status}`);
      kickNotify();
      return data;
    } catch (e) {
      if (e instanceof NetError && e.code !== 'not_ready' && e.code !== 'offline') throw e;
      const r = await networkRpc('st_send', { p_chat: chatId, p_body: body, p_held: false });
      kickNotify();
      return r;
    }
  },
  async plansFromUpForIt() {
    try {
      const rows = await networkRpc('uf_plans_public', {});
      return (Array.isArray(rows) ? rows : []).map(planFromUpForIt).filter(Boolean);
    } catch { return []; }
  },
  async enablePush(uid) {
    if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return { ok: false, why: 'unsupported' };
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, why: 'denied' };
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    await networkRpc('st_push_save', { p_endpoint: j.endpoint, p_keys: j.keys });
    return { ok: true };
  },
};

function urlB64ToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

// Best-effort pokes at the optional edge functions. Failures are silence by design.
export function kickNotify() {
  if (isDemo()) return;
  try {
    fetch(`${SUPABASE_URL}/functions/v1/${NOTIFY_FN}`, {
      method: 'POST', keepalive: true,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  } catch { /* fine */ }
}
function moderatePhoto(path) {
  if (isDemo()) return;
  network.session().then((s) => fetch(`${SUPABASE_URL}/functions/v1/${MODERATE_FN}`, {
    method: 'POST', keepalive: true,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${s?.access_token ?? SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_path: path }),
  })).catch(() => {});
}

// ------------------------------------------------------------- demo transport

let demo = null;
function demoBackend() {
  if (!demo) demo = seedDemo(new FakeBackend());
  return {
    kind: 'demo',
    rpc: (fn, args) => demo.rpc(fn, args).catch((e) => { throw new NetError(e.code || 'error'); }),
    session: async () => demo.session(),
    onAuth: async (cb) => demo.onAuth(cb),
    signInGoogle: async () => demo.signIn(),
    signInEmail: async () => demo.signIn(),
    signOut: async () => demo.signOut(),
    uploadPhoto: async (uid, idx) => demo.uploadPhoto(uid, idx),
    removePhoto: async (uid, idx) => demo.rpc('st_remove_photo', { p_idx: idx }),
    removeAllPhotos: async () => {},
    photoUrls: async (paths) => demo.photoUrls(paths),
    subscribeChat: async (chatId, cb) => demo.subscribe(chatId, cb),
    send: async (chatId, body) => demo.rpc('st_send', { p_chat: chatId, p_body: body, p_held: /\bheldme\b/i.test(body) }),
    plansFromUpForIt: async () => demo.plansFromUpForIt(),
    enablePush: async () => ({ ok: false, why: 'demo' }),
  };
}

export function backend() { return isDemo() ? demoBackend() : network; }

// ------------------------------------------------------------- plans feed

let plansCache = null;
export async function fetchPlans() {
  if (plansCache) return plansCache;
  let events = [];
  try {
    const r = await fetch(new URL('data/plans.json', document.baseURI));
    if (r.ok) events = (await r.json()).plans || [];
  } catch { /* offline: no events plans */ }
  const uf = await backend().plansFromUpForIt();
  const seen = new Set();
  plansCache = [...uf, ...events].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  return plansCache;
}

// ------------------------------------------------------------- copy for errors

export function explain(err) {
  const code = err && err.code ? err.code : 'error';
  return ({
    offline: "You're offline. Try again in a moment.",
    not_ready: "Small Talk isn't switched on yet. Check back soon.",
    not_signed_in: 'Sign in first.',
    no_profile: 'Finish your profile first.',
    auth_failed: "Sign-in didn't go through. Try again.",
    google_off: 'Google sign-in is still being switched on. Use “Email me a link” for now.',
    slow_down: "That's plenty for now — try again later.",
    dating_cap: "You've said hi to five people this week in the dating lane. More next week.",
    already_said_hi: 'You already said hi.',
    not_found: "That's not available.",
    bad_hi: 'One line — that’s the whole opener.',
    bad_message: 'Say something first (under 1,000 characters).',
    bad_profile: "Something's missing — check the highlighted fields.",
    too_young: 'Small Talk is for adults, 18 and up.',
    bad_intent: 'Needed for the dating lane only. Never shown.',
    bad_photo: "That photo didn't save. Try another.",
    upload_failed: "That photo didn't upload. Try a smaller one.",
    card_open: 'Finish the open card first.',
    bad_answer: 'Write something (under 280 characters).',
    blocked: "You can't message this person.",
    bad_report: "Pick a reason.",
    not_mod: "That's the back room.",
  })[code] || 'Something went wrong. Try again.';
}
