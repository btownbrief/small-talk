// st-notify — drains st_notify_queue (email via Resend + web push), moderates
// photos that are still 'pending', and sweeps photo folders whose account no
// longer exists. Called two ways:
//   • by the app after an action that enqueues (fire-and-forget, with the
//     member's access token — any signed-in member may poke it);
//   • by pg_cron every 5 minutes with the X-Cron-Secret header
//     (see supabase/small-talk-CRON.sql). Without the secret set, only the
//     member path works.
// Rows are claimed atomically (st_notify_claim) so two drains never send the
// same thing twice; claimed rows stay marked even when delivery fails, so an
// outage never becomes a flood later.
//
// Emails are deliberately content-free ("Someone said hi", "New message") —
// the inbox is the app.
//
// Deploy:  supabase functions deploy st-notify --no-verify-jwt --project-ref jnouvwxomrcffqwilqkq
//          (verify_jwt off because the cron path has no user JWT; auth is done below)
// Secrets: RESEND_API_KEY, NOTIFY_FROM, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//          NOTIFY_CRON_SECRET (any long random string; same value goes in the vault for cron),
//          OPENAI_API_KEY (photo moderation; without it pending photos are simply marked ok)

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const APP_URL = 'https://play.btownbrief.com/small-talk/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const COPY: Record<string, { subject: string; body: string; url: string }> = {
  hi: { subject: 'Someone said hi on Small Talk', body: 'Someone in Burlington said hi. One line is waiting for you in Inbox.', url: APP_URL + '#inbox' },
  wave: { subject: 'They waved back', body: 'Your hi got a wave. The chat is open.', url: APP_URL + '#inbox' },
  message: { subject: 'New message on Small Talk', body: 'You have a new message.', url: APP_URL + '#inbox' },
  meet: { subject: 'Someone wants to meet up', body: 'A plan was proposed in one of your chats.', url: APP_URL + '#inbox' },
  meet_accepted: { subject: "It's on", body: 'Your plan was accepted.', url: APP_URL + '#inbox' },
};

async function moderateImage(url: string): Promise<boolean | null> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return false; // no key: nothing to check against, let it through (documented baseline)
  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url } }] }),
    });
    if (!r.ok) return null; // leave pending, try again next drain
    const res = (await r.json())?.results?.[0];
    if (!res) return null;
    const c = res.categories || {};
    return Boolean(c['sexual'] || c['sexual/minors'] || c['violence/graphic'] || c['self-harm'] || c['harassment/threatening']);
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // who's asking? a signed-in member (access token) or the cron (shared secret)
  const cronSecret = Deno.env.get('NOTIFY_CRON_SECRET');
  const isCron = Boolean(cronSecret) && req.headers.get('x-cron-secret') === cronSecret;
  if (!isCron) {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: who } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!who?.user?.id) return json({ error: 'not_signed_in' }, 401);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NOTIFY_FROM') || 'Small Talk <hello@btownbrief.com>';
  const vPub = Deno.env.get('VAPID_PUBLIC_KEY'), vPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (vPub && vPriv) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@btownbrief.com', vPub, vPriv);

  // 1. notifications — claim atomically, then deliver
  const { data: rows, error: claimErr } = await db.rpc('st_notify_claim', { p_limit: 50 });
  if (claimErr) return json({ error: 'claim_failed', detail: claimErr.message }, 500);
  const seen = new Set<string>();
  let emails = 0, pushes = 0;
  for (const r of (rows || []) as { id: string; user_id: string; kind: string }[]) {
    const key = `${r.user_id}:${r.kind}`; if (seen.has(key)) continue; seen.add(key);   // one per (user, kind) per drain
    const copy = COPY[r.kind] || COPY.message;
    if (resendKey) {
      const { data: u } = await db.auth.admin.getUserById(r.user_id);
      const to = u?.user?.email;
      if (to) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, subject: copy.subject, text: `${copy.body}\n\n${copy.url}\n\n— Small Talk, Burlington. Turn these off under Me → Notifications in the app, or reply to this email.` }),
        }).catch(() => null);
        if (res?.ok) emails++;
      }
    }
    if (vPub && vPriv) {
      const { data: subs } = await db.from('st_push_subs').select('endpoint, keys').eq('user_id', r.user_id);
      for (const s of subs || []) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: 'Small Talk', body: copy.body, url: copy.url, tag: r.kind })); pushes++; }
        catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await db.from('st_push_subs').delete().eq('endpoint', s.endpoint); }
      }
    }
  }

  // 2. photos still 'pending' — moderate server-side (the client's own call is best-effort)
  let checked = 0, flagged = 0;
  const { data: pend } = await db.from('st_photos').select('user_id, idx, path').eq('status', 'pending').order('created_at').limit(20);
  for (const ph of pend || []) {
    const { data: signed } = await db.storage.from('st-photos').createSignedUrl(ph.path, 120);
    if (!signed?.signedUrl) { // object missing (upload failed or was removed): drop the row
      await db.from('st_photos').delete().eq('user_id', ph.user_id).eq('idx', ph.idx); continue;
    }
    const bad = await moderateImage(signed.signedUrl);
    if (bad === null) continue;
    checked++;
    if (bad) { flagged++; await db.storage.from('st-photos').remove([ph.path]); await db.from('st_photos').update({ status: 'flagged' }).eq('user_id', ph.user_id).eq('idx', ph.idx); }
    else await db.from('st_photos').update({ status: 'ok' }).eq('user_id', ph.user_id).eq('idx', ph.idx);
  }

  // 3. sweep photo folders whose account is gone ("Delete everything" while offline, etc.)
  let swept = 0;
  if (isCron) {
    const { data: folders } = await db.storage.from('st-photos').list('', { limit: 1000 });
    for (const f of folders || []) {
      if (!/^[0-9a-f-]{36}$/.test(f.name)) continue;
      const { data: u } = await db.auth.admin.getUserById(f.name);
      if (u?.user) continue;
      const { data: files } = await db.storage.from('st-photos').list(f.name, { limit: 10 });
      const paths = (files || []).map((x) => `${f.name}/${x.name}`);
      if (paths.length) { await db.storage.from('st-photos').remove(paths); swept += paths.length; }
    }
  }

  return json({ sent: rows?.length ?? 0, emails, pushes, photosChecked: checked, photosFlagged: flagged, swept, email: Boolean(resendKey), push: Boolean(vPub && vPriv), cron: isCron });
});
