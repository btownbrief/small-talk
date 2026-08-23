// st-moderate — OPTIONAL but recommended. Two jobs:
//   1. POST { chat_id, body }   → runs OpenAI moderation on the text, then
//      inserts the message via st_send AS THE CALLER (their JWT), held=true
//      if flagged. Held messages are visible only to the sender until a
//      moderator releases them in mod.html.
//   2. POST { photo_path }      → runs moderation on a just-uploaded photo;
//      if flagged, deletes the object and marks the row 'flagged'.
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

  if (typeof body.photo_path === 'string') {
    // who is calling? (the RPC below will fail for anyone else's path anyway)
    const { data: u } = await asUser.auth.getUser();
    const uid = u?.user?.id;
    if (!uid || !body.photo_path.startsWith(uid + '/')) return json({ error: 'not_yours' }, 403);
    const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: signed } = await service.storage.from('st-photos').createSignedUrl(body.photo_path, 120);
    if (!signed?.signedUrl) return json({ ok: false, why: 'no_url' });
    const m = await moderate([{ type: 'image_url', image_url: { url: signed.signedUrl } }]);
    if (m.flagged) {
      await service.storage.from('st-photos').remove([body.photo_path]);
      const idx = Number(body.photo_path.match(/\/(\d)\.\w+$/)?.[1] ?? 0);
      await service.from('st_photos').update({ status: 'flagged' }).eq('user_id', uid).eq('idx', idx);
      return json({ ok: true, flagged: true, why: m.why });
    }
    return json({ ok: true, flagged: false, why: m.why });
  }
  return json({ error: 'bad_request' }, 400);
});
