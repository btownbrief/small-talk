// st-moderate — OPTIONAL but recommended. Four jobs, all AS THE CALLER (their JWT):
//   1. POST { chat_id, body }       → OpenAI moderation on the text, then st_send
//      with held=true if flagged. Held messages are visible only to the sender
//      until a moderator releases them in mod.html.
//   2. POST { hi: {to, lane, note} } → moderation on the hi note; a flagged note
//      is refused outright ('flagged_hi' — there is no "held" for a first line).
//   3. POST { reply: {hello, body} } → moderation, then st_reply held=flagged.
//   4. POST { photo_path }          → moderation on a just-uploaded photo; marks
//      the row ok, or deletes the object and marks it flagged. (st-notify also
//      sweeps anything still pending, so a client that skips this call gains nothing.)
// Without OPENAI_API_KEY the function still works: it inserts unmoderated
// (held=false) and says so in the response — the client can't tell, the
// queue is still there. Without the function at all (404) the client falls
// back to the plain st_send RPC. Nothing here blocks sending on an outage.
//
// Deploy:  supabase functions deploy st-moderate --project-ref jnouvwxomrcffqwilqkq
// Secrets: supabase secrets set OPENAI_API_KEY=sk-... --project-ref jnouvwxomrcffqwilqkq
// (verify_jwt stays ON for this one — we need the caller's identity.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function moderate(input: unknown): Promise<{ flagged: boolean; why: string }> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return { flagged: false, why: 'no_key' };
  try {
    const r = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
    });
    if (!r.ok) return { flagged: false, why: `openai_${r.status}` };
    const d = await r.json();
    const res = d?.results?.[0];
    if (!res) return { flagged: false, why: 'no_result' };
    // hold on the categories that matter in a chat between strangers; ignore e.g. mild profanity
    const cats = res.categories || {};
    const scores = res.category_scores || {};
    const hold = Boolean(cats['harassment/threatening'] || cats['sexual/minors'] || cats['violence/graphic'] || cats['self-harm/instructions']
      || (cats['harassment'] && (scores['harassment'] ?? 0) > 0.7) || (cats['sexual'] && (scores['sexual'] ?? 0) > 0.8) || (cats['hate'] && (scores['hate'] ?? 0) > 0.6));
    return { flagged: hold, why: hold ? Object.entries(cats).filter(([, v]) => v).map(([k]) => k).join(',') : 'ok' };
  } catch { return { flagged: false, why: 'openai_error' }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization') ?? '';
  const body = await req.json().catch(() => ({}));
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  // act as the caller for the insert (RLS + auth.uid() inside st_send)
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });

  if (typeof body.chat_id === 'string' && typeof body.body === 'string') {
    const text = body.body.trim().slice(0, 1000);
    if (!text) return json({ error: 'bad_message' }, 400);
    const m = await moderate(text);
    const { data, error } = await asUser.rpc('st_send', { p_chat: body.chat_id, p_body: text, p_held: m.flagged });
    if (error) return json({ error: String(error.message).split(':')[0] }, 400);
    return json({ ...(data as object), moderation: m.why });
  }

  if (body.hi && typeof body.hi.to === 'string' && typeof body.hi.note === 'string') {
    const note = body.hi.note.trim().slice(0, 140);
    if (!note) return json({ error: 'bad_hi' }, 400);
    const m = await moderate(note);
    if (m.flagged) return json({ error: 'flagged_hi', moderation: m.why }, 400);
    const { data, error } = await asUser.rpc('st_hi', { p_to: body.hi.to, p_lane: body.hi.lane, p_note: note });
    if (error) return json({ error: String(error.message).split(':')[0] }, 400);
    return json({ ...(data as object), moderation: m.why });
  }

  if (body.reply && typeof body.reply.hello === 'string' && typeof body.reply.body === 'string') {
    const text = body.reply.body.trim().slice(0, 1000);
    if (!text) return json({ error: 'bad_message' }, 400);
    const m = await moderate(text);
    const { data, error } = await asUser.rpc('st_reply', { p_hello: body.reply.hello, p_body: text, p_held: m.flagged });
    if (error) return json({ error: String(error.message).split(':')[0] }, 400);
    return json({ ...(data as object), held: m.flagged, moderation: m.why });
  }

  if (typeof body.photo_path === 'string') {
    // who is calling? (the RPC below will fail for anyone else's path anyway)
    const { data: u } = await asUser.auth.getUser();
    const uid = u?.user?.id;
    if (!uid || !body.photo_path.startsWith(uid + '/')) return json({ error: 'not_yours' }, 403);
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: signed } = await service.storage.from('st-photos').createSignedUrl(body.photo_path, 120);
    if (!signed?.signedUrl) return json({ ok: false, why: 'no_url' });
    const m = await moderate([{ type: 'image_url', image_url: { url: signed.signedUrl } }]);
    const idx = Number(body.photo_path.match(/\/(\d)\.\w+$/)?.[1] ?? 0);
    if (m.flagged) {
      await service.storage.from('st-photos').remove([body.photo_path]);
      await service.from('st_photos').update({ status: 'flagged' }).eq('user_id', uid).eq('idx', idx);
      return json({ ok: true, flagged: true, why: m.why });
    }
    // only 'pending' → 'ok' (never un-flags); if OpenAI errored, leave it pending for the st-notify sweep
    if (m.why === 'ok' || m.why === 'no_key') await service.from('st_photos').update({ status: 'ok' }).eq('user_id', uid).eq('idx', idx).eq('status', 'pending');
    return json({ ok: true, flagged: false, why: m.why });
  }
  return json({ error: 'bad_request' }, 400);
});
