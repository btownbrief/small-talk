// st-notify — OPTIONAL. Drains st_notify_queue: for each pending row, email
// the person (Resend) and, if they have a push subscription, push too. The
// client pokes this endpoint after actions that enqueue (fire-and-forget);
// a cron can also hit it. At most one email per queue row; rows are marked
// sent even when delivery fails (so an outage never becomes a flood later).
//
// Emails are deliberately content-free ("Someone said hi", "New message") —
// the inbox is the app. Without RESEND_API_KEY: pushes still go out if VAPID
// keys exist; otherwise rows are marked sent and nothing is delivered, which
// is the documented baseline (everything waits in Inbox).
//
// Deploy:  supabase functions deploy st-notify --no-verify-jwt --project-ref jnouvwxomrcffqwilqkq
// Secrets: supabase secrets set RESEND_API_KEY=re_... NOTIFY_FROM="Small Talk <hello@btownbrief.com>" \
//            VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:hello@btownbrief.com \
//            --project-ref jnouvwxomrcffqwilqkq
// (generate VAPID keys with: node scripts/vapid.mjs)

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const APP_URL = 'https://play.btownbrief.com/small-talk/';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const ok = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, 'Content-Type': 'application/json' } });
const COPY: Record<string, { subject: string; body: string; url: string }> = {
  hi: { subject: 'Someone said hi on Small Talk', body: 'Someone in Burlington said hi. One line is waiting for you in Inbox.', url: APP_URL + '#inbox' },
  wave: { subject: 'They waved back', body: 'Your hi got a wave. The chat is open.', url: APP_URL + '#inbox' },
  message: { subject: 'New message on Small Talk', body: 'You have a new message.', url: APP_URL + '#inbox' },
  meet: { subject: 'Someone wants to meet up', body: 'A plan was proposed in one of your chats.', url: APP_URL + '#inbox' },
  meet_accepted: { subject: "It's on", body: 'Your plan was accepted.', url: APP_URL + '#inbox' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('NOTIFY_FROM') || 'Small Talk <hello@btownbrief.com>';
  const vPub = Deno.env.get('VAPID_PUBLIC_KEY'), vPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (vPub && vPriv) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@btownbrief.com', vPub, vPriv);

  // claim up to 50 pending rows atomically-ish (mark first, then deliver)
  const { data: rows } = await db.from('st_notify_queue').select('id, user_id, kind, created_at').is('sent_at', null).order('created_at').limit(50);
  if (!rows?.length) return ok({ sent: 0 });
  const ids = rows.map((r) => r.id);
  await db.from('st_notify_queue').update({ sent_at: new Date().toISOString() }).in('id', ids);

  // collapse to one notification per (user, kind) per drain so a chatty minute = one email
  const seen = new Set<string>();
  let emails = 0, pushes = 0;
  for (const r of rows) {
    const key = `${r.user_id}:${r.kind}`; if (seen.has(key)) continue; seen.add(key);
    const copy = COPY[r.kind] || COPY.message;
    // email
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
    // push
    if (vPub && vPriv) {
      const { data: subs } = await db.from('st_push_subs').select('endpoint, keys').eq('user_id', r.user_id);
      for (const s of subs || []) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: 'Small Talk', body: copy.body, url: copy.url, tag: r.kind })); pushes++; }
        catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await db.from('st_push_subs').delete().eq('endpoint', s.endpoint); }
      }
    }
  }
  return ok({ sent: rows.length, emails, pushes, email: Boolean(resendKey), push: Boolean(vPub && vPriv) });
});
