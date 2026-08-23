-- SMALL TALK — backend. 2026-08-23.
-- Install on the btown Supabase project (jnouvwxomrcffqwilqkq), same project
-- as the leaderboard / rooms / party / lake-breath / whos-playing (wp_*) and
-- Up For It (uf_*). Brand-new st_* objects only. Safe to re-run.
--
-- Identity is Supabase Auth (Google or email magic link) — auth.uid(). There
-- are NO device tokens here, and nothing in this file reads wp_* or uf_*
-- tables (the Plans tab calls uf_plans_public() from the client; see
-- PLANS-CONTRACT.md).
--
-- The model, in one breath: a PROFILE (first name, birth year, neighborhood,
-- up to 4 tabs, 2–3 prompts, 1–3 photos) is visible to signed-in members.
-- An INTENT (open to dating + gender + seeking) is PRIVATE: it is never
-- returned about anyone else, it only routes what you see. A HI is one
-- line ≤140 to one person (dating lane: 5 per 7 days per sender). Passes
-- are stored only for the passer. A WAVE or a REPLY opens a CHAT (text
-- only). A CARD is a question both answer privately and see together. A
-- MEET is a proposal (a plan from the feed, a place, or the standing
-- Saturday coffee); AFTER is a private one-tap check-in. Two reports
-- SUPPRESS a profile from browse pending a moderator; nothing is deleted
-- without a human. Delete-everything is one RPC and really deletes.
--
-- Honest threat model: the anon key is public; RLS + SECURITY DEFINER RPCs
-- + rate limits + reports + the back room stop casual mischief, not a
-- determined adversary. Nothing here is presented as integrity-protected.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table if not exists public.st_mods (
  email text primary key
);
insert into public.st_mods (email) values ('stephenvdavis@gmail.com') on conflict do nothing;

create table if not exists public.st_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(first_name) between 1 and 24),
  birth_year int not null,
  neighborhood text not null check (neighborhood in ('downtown','one','south-end','hill','new-north-end','winooski','south-burlington','essex','shelburne','colchester','elsewhere')),
  tabs text[] not null default '{}' check (cardinality(tabs) <= 4),
  prompts jsonb not null default '[]'::jsonb,
  visible boolean not null default true,      -- user's own switch
  suppressed boolean not null default false,  -- 2 reports → true, pending review
  banned boolean not null default false,      -- moderator
  reports int not null default 0,
  confirmed_meets int not null default 0,     -- private reliability signal (never rendered)
  showed_meets int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists st_profiles_browse on public.st_profiles (visible, suppressed, banned, created_at desc);

create table if not exists public.st_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dating_open boolean not null default false,
  gender text check (gender in ('woman','man','nonbinary')),
  seeking text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.st_photos (
  user_id uuid not null references auth.users(id) on delete cascade,
  idx int not null check (idx between 0 and 2),
  path text not null,
  status text not null default 'ok' check (status in ('ok','pending','flagged')),
  created_at timestamptz not null default now(),
  primary key (user_id, idx)
);

create table if not exists public.st_hellos (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check (lane in ('friends','dating')),
  note text not null check (length(note) between 1 and 140),
  status text not null default 'open' check (status in ('open','waved','replied','passed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  unique (from_id, to_id)
);
create index if not exists st_hellos_to on public.st_hellos (to_id, status, expires_at);
create index if not exists st_hellos_from on public.st_hellos (from_id, lane, created_at desc);

create table if not exists public.st_passes (
  user_id uuid not null references auth.users(id) on delete cascade,
  other_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, other_id)
);

create table if not exists public.st_chats (
  id uuid primary key default gen_random_uuid(),
  a_id uuid not null references auth.users(id) on delete cascade,
  b_id uuid not null references auth.users(id) on delete cascade,
  lane text not null check (lane in ('friends','dating')),
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  check (a_id < b_id),
  unique (a_id, b_id)
);

create table if not exists public.st_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.st_chats(id) on delete cascade,
  from_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 1000),
  held boolean not null default false,   -- moderation hold: sender sees it, recipient doesn't
  created_at timestamptz not null default now()
);
create index if not exists st_messages_chat on public.st_messages (chat_id, created_at);

create table if not exists public.st_cards (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.st_chats(id) on delete cascade,
  question_id text not null,
  question text not null check (length(question) <= 240),
  answers jsonb not null default '{}'::jsonb,   -- { "<uid>": "text" } — revealed only when both present
  created_at timestamptz not null default now(),
  revealed_at timestamptz
);
create index if not exists st_cards_chat on public.st_cards (chat_id, created_at);

create table if not exists public.st_plan_members (
  plan_id text not null check (length(plan_id) between 1 and 80),
  user_id uuid not null references auth.users(id) on delete cascade,
  show_name boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create table if not exists public.st_meets (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.st_chats(id) on delete cascade,
  proposer_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan','place','standing')),
  plan_id text,
  place jsonb,                                   -- { name, neighborhood, why }
  at timestamptz,
  status text not null default 'proposed' check (status in ('proposed','accepted','declined','done')),
  after jsonb not null default '{}'::jsonb,      -- { "<uid>": "good"|"fine"|"report" }
  created_at timestamptz not null default now()
);
create index if not exists st_meets_chat on public.st_meets (chat_id, created_at desc);

create table if not exists public.st_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  other_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'block' check (kind in ('block','hide')),
  created_at timestamptz not null default now(),
  primary key (user_id, other_id)
);

create table if not exists public.st_reports (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users(id) on delete cascade,
  about_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('fake','harassment','unsafe','minor','other')),
  detail text not null default '' check (length(detail) <= 500),
  ref text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
create index if not exists st_reports_open on public.st_reports (resolved_at, created_at desc);

create table if not exists public.st_push_subs (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  keys jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

-- notification outbox: the edge function drains it (email always, push if subscribed)
create table if not exists public.st_notify_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('hi','wave','message','meet','meet_accepted')),
  ref uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists st_notify_pending on public.st_notify_queue (sent_at, created_at);

-- ---------------------------------------------------------------- RLS

alter table public.st_mods enable row level security;
alter table public.st_profiles enable row level security;
alter table public.st_intents enable row level security;
alter table public.st_photos enable row level security;
alter table public.st_hellos enable row level security;
alter table public.st_passes enable row level security;
alter table public.st_chats enable row level security;
alter table public.st_messages enable row level security;
alter table public.st_cards enable row level security;
alter table public.st_plan_members enable row level security;
alter table public.st_meets enable row level security;
alter table public.st_blocks enable row level security;
alter table public.st_reports enable row level security;
alter table public.st_push_subs enable row level security;
alter table public.st_notify_queue enable row level security;

-- Everything goes through RPCs. The one direct read is messages (realtime
-- needs SELECT): a chat member sees a message if it isn't held or is theirs.
drop policy if exists st_messages_member_read on public.st_messages;
create policy st_messages_member_read on public.st_messages for select to authenticated
  using (
    exists (select 1 from public.st_chats c where c.id = chat_id and (c.a_id = auth.uid() or c.b_id = auth.uid()))
    and (not held or from_id = auth.uid())
  );
-- cards too, so a reveal arrives live
drop policy if exists st_cards_member_read on public.st_cards;
create policy st_cards_member_read on public.st_cards for select to authenticated
  using (exists (select 1 from public.st_chats c where c.id = chat_id and (c.a_id = auth.uid() or c.b_id = auth.uid())));

-- ---------------------------------------------------------------- helpers

create or replace function public.st_clean(t text, maxlen int)
returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(t,''),
    '(https?://|www\.)\S+|\m[a-z0-9-]+\.(com|net|org|io|app|me|co|ly|gg|tv)\M(/\S*)?', '', 'gi'),
    '\s+', ' ', 'g')), maxlen)
$$;

create or replace function public.st_is_mod()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.st_mods m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.st_uid()
returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return u;
end $$;

-- the relation filter: blocked/hidden either way, banned, suppressed, invisible
create or replace function public.st_excluded(viewer uuid, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select viewer = target
    or exists (select 1 from public.st_blocks b where (b.user_id = viewer and b.other_id = target) or (b.user_id = target and b.other_id = viewer))
    or exists (select 1 from public.st_profiles p where p.user_id = target and (p.banned or p.suppressed or not p.visible))
$$;

-- mirrors core.canSee (visibility/blocks handled by st_excluded)
create or replace function public.st_can_see(viewer uuid, target uuid, lane text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare vi public.st_intents; ti public.st_intents;
begin
  if viewer = target then return false; end if;
  if lane = 'friends' then return true; end if;
  if lane <> 'dating' then return false; end if;
  select * into vi from public.st_intents where user_id = viewer;
  select * into ti from public.st_intents where user_id = target;
  if vi.user_id is null or ti.user_id is null then return false; end if;
  if not vi.dating_open or not ti.dating_open then return false; end if;
  return ti.gender = any(vi.seeking) and vi.gender = any(ti.seeking);
end $$;

create or replace function public.st_age(birth_year int)
returns int language sql stable as $$ select extract(year from now())::int - birth_year $$;

-- public projection of a profile (never includes intent)
create or replace function public.st_card(p public.st_profiles, viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.user_id,
    'firstName', p.first_name,
    'age', public.st_age(p.birth_year),
    'neighborhood', p.neighborhood,
    'tabs', to_jsonb(p.tabs),
    'prompts', p.prompts,
    'photos', coalesce((select jsonb_agg(ph.path order by ph.idx) from public.st_photos ph where ph.user_id = p.user_id and ph.status = 'ok'), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(pm.plan_id) from public.st_plan_members pm where pm.user_id = p.user_id and pm.show_name), '[]'::jsonb),
    'createdAt', p.created_at,
    'hi', (select jsonb_build_object('id', h.id, 'status', h.status) from public.st_hellos h where h.from_id = viewer and h.to_id = p.user_id and h.expires_at > now() and h.status <> 'passed' limit 1)
  )
$$;

-- ---------------------------------------------------------------- me / profile

create or replace function public.st_me()
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); p public.st_profiles; i public.st_intents; r jsonb;
begin
  select * into p from public.st_profiles where user_id = u;
  if p.user_id is null then
    return jsonb_build_object('id', u, 'profile', null, 'intent', null, 'email', auth.jwt() ->> 'email', 'isMod', public.st_is_mod());
  end if;
  update public.st_profiles set last_seen = now() where user_id = u;
  select * into i from public.st_intents where user_id = u;
  r := jsonb_build_object(
    'id', u,
    'email', auth.jwt() ->> 'email',
    'isMod', public.st_is_mod(),
    'profile', public.st_card(p, u) || jsonb_build_object('birthYear', p.birth_year, 'visible', p.visible, 'suppressed', p.suppressed,
       'photosAll', coalesce((select jsonb_agg(jsonb_build_object('idx', ph.idx, 'path', ph.path, 'status', ph.status) order by ph.idx) from public.st_photos ph where ph.user_id = u), '[]'::jsonb),
       'planIds', coalesce((select jsonb_agg(pm.plan_id) from public.st_plan_members pm where pm.user_id = u), '[]'::jsonb)),
    'intent', case when i.user_id is null then jsonb_build_object('datingOpen', false, 'gender', null, 'seeking', '[]'::jsonb)
                   else jsonb_build_object('datingOpen', i.dating_open, 'gender', i.gender, 'seeking', to_jsonb(i.seeking)) end,
    'datingHiRemaining', greatest(0, 5 - (select count(*) from public.st_hellos h where h.from_id = u and h.lane = 'dating' and h.created_at > now() - interval '7 days'))
  );
  return r;
end $$;

create or replace function public.st_save_profile(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid();
  v_name text := public.st_clean(p ->> 'firstName', 24);
  v_year int := nullif(p ->> 'birthYear', '')::int;
  v_hood text := p ->> 'neighborhood';
  v_tabs text[]; v_prompts jsonb := '[]'::jsonb; el jsonb; a text; seen text[] := '{}';
begin
  if length(v_name) < 1 then raise exception 'bad_profile'; end if;
  if v_year is null or public.st_age(v_year) < 18 or public.st_age(v_year) > 110 then raise exception 'too_young'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_tabs from jsonb_array_elements_text(coalesce(p -> 'tabs', '[]'::jsonb)) x where x in ('dogs','trails','music','games');
  if cardinality(v_tabs) > 4 then v_tabs := v_tabs[1:4]; end if;
  for el in select * from jsonb_array_elements(coalesce(p -> 'prompts', '[]'::jsonb)) loop
    a := public.st_clean(el ->> 'a', 140);
    if (el ->> 'id') in ('weekend','send','lately','order','weather','teach','argue','next') and length(a) > 0 and not ((el ->> 'id') = any(seen)) then
      v_prompts := v_prompts || jsonb_build_array(jsonb_build_object('id', el ->> 'id', 'a', a));
      seen := seen || (el ->> 'id');
    end if;
    exit when jsonb_array_length(v_prompts) >= 3;
  end loop;
  if jsonb_array_length(v_prompts) < 2 then raise exception 'bad_profile'; end if;
  insert into public.st_profiles (user_id, first_name, birth_year, neighborhood, tabs, prompts)
  values (u, v_name, v_year, v_hood, v_tabs, v_prompts)
  on conflict (user_id) do update set first_name = excluded.first_name, birth_year = excluded.birth_year,
    neighborhood = excluded.neighborhood, tabs = excluded.tabs, prompts = excluded.prompts, updated_at = now();
  return public.st_me();
exception when check_violation then raise exception 'bad_profile';
end $$;

create or replace function public.st_set_visible(v boolean)
returns void language sql security definer set search_path = public as $$
  update public.st_profiles set visible = v, updated_at = now() where user_id = public.st_uid();
$$;

create or replace function public.st_set_intent(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); v_open boolean := coalesce((p ->> 'datingOpen')::boolean, false);
  v_gender text := p ->> 'gender'; v_seeking text[];
begin
  if not v_open then
    insert into public.st_intents (user_id, dating_open, gender, seeking) values (u, false, null, '{}')
    on conflict (user_id) do update set dating_open = false, updated_at = now();
    return public.st_me();
  end if;
  if v_gender not in ('woman','man','nonbinary') then raise exception 'bad_intent'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_seeking from jsonb_array_elements_text(coalesce(p -> 'seeking', '[]'::jsonb)) x where x in ('woman','man','nonbinary');
  if cardinality(v_seeking) = 0 then raise exception 'bad_intent'; end if;
  insert into public.st_intents (user_id, dating_open, gender, seeking) values (u, true, v_gender, v_seeking)
  on conflict (user_id) do update set dating_open = true, gender = excluded.gender, seeking = excluded.seeking, updated_at = now();
  return public.st_me();
end $$;

-- photos: the client uploads to storage bucket st-photos at <uid>/<idx>.jpg, then registers it
create or replace function public.st_set_photo(p_idx int, p_path text, p_status text default 'ok')
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid();
begin
  if p_idx not between 0 and 2 then raise exception 'bad_photo'; end if;
  if p_path !~ ('^' || u::text || '/[0-2]\.(jpg|jpeg|png|webp)$') then raise exception 'bad_photo'; end if;
  if p_status not in ('ok','pending','flagged') then p_status := 'ok'; end if;
  insert into public.st_photos (user_id, idx, path, status) values (u, p_idx, p_path, p_status)
  on conflict (user_id, idx) do update set path = excluded.path, status = excluded.status, created_at = now();
end $$;

create or replace function public.st_remove_photo(p_idx int)
returns void language sql security definer set search_path = public as $$
  delete from public.st_photos where user_id = public.st_uid() and idx = p_idx;
$$;

-- ---------------------------------------------------------------- browse

create or replace function public.st_browse(p_lane text default 'friends', p_tab text default null, p_before timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); me public.st_profiles;
begin
  select * into me from public.st_profiles where user_id = u;
  if me.user_id is null then raise exception 'no_profile'; end if;
  if p_lane not in ('friends','dating') then raise exception 'bad_lane'; end if;
  return coalesce((
    select jsonb_agg(public.st_card(p, u) order by (exists (select 1 from public.st_plan_members pm where pm.user_id = p.user_id and pm.show_name)) desc, p.created_at desc)
    from (
      select p.* from public.st_profiles p
      where p.user_id <> u
        and p.visible and not p.suppressed and not p.banned
        and not public.st_excluded(u, p.user_id)
        and public.st_can_see(u, p.user_id, p_lane)
        and not exists (select 1 from public.st_passes ps where ps.user_id = u and ps.other_id = p.user_id)
        and (p_tab is null or p_tab = any(p.tabs))
        and (p_before is null or p.created_at < p_before)
      order by p.created_at desc
      limit 24
    ) p
  ), '[]'::jsonb);
end $$;

-- anonymous front door: counts and anonymized fragments, never names or photos
create or replace function public.st_public_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from public.st_profiles where visible and not banned),
    'fragments', coalesce((
      select jsonb_agg(jsonb_build_object('neighborhood', neighborhood, 'tabs', to_jsonb(tabs)))
      from (select neighborhood, tabs from public.st_profiles where visible and not suppressed and not banned order by random() limit 6) f
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------- hi / pass / wave / reply

create or replace function public.st_hi(p_to uuid, p_lane text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); n text := public.st_clean(p_note, 140); h public.st_hellos;
begin
  if p_lane not in ('friends','dating') then raise exception 'bad_lane'; end if;
  if length(n) < 1 then raise exception 'bad_hi'; end if;
  if p_to = u or not exists (select 1 from public.st_profiles where user_id = p_to) then raise exception 'not_found'; end if;
  if public.st_excluded(u, p_to) or not public.st_can_see(u, p_to, p_lane) then raise exception 'not_found'; end if;
  if (select count(*) from public.st_hellos where from_id = u and created_at > now() - interval '1 day') >= 20 then raise exception 'slow_down'; end if;
  if p_lane = 'dating' and (select count(*) from public.st_hellos where from_id = u and lane = 'dating' and created_at > now() - interval '7 days') >= 5 then
    raise exception 'dating_cap';
  end if;
  insert into public.st_hellos (from_id, to_id, lane, note) values (u, p_to, p_lane, n)
  on conflict (from_id, to_id) do update set lane = excluded.lane, note = excluded.note, status = 'open', created_at = now(), expires_at = now() + interval '7 days'
    where public.st_hellos.expires_at < now() or public.st_hellos.status = 'passed'
  returning * into h;
  if h.id is null then raise exception 'already_said_hi'; end if;
  insert into public.st_notify_queue (user_id, kind, ref) values (p_to, 'hi', h.id);
  return jsonb_build_object('id', h.id, 'status', h.status);
end $$;

create or replace function public.st_pass(p_other uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.st_passes (user_id, other_id) values (public.st_uid(), p_other) on conflict do nothing;
$$;

-- recipient quietly declines a hi: it vanishes from their inbox; the sender is told nothing
create or replace function public.st_hi_pass(p_hello uuid)
returns void language sql security definer set search_path = public as $$
  update public.st_hellos set status = 'passed' where id = p_hello and to_id = public.st_uid();
$$;

create or replace function public.st_open_chat(p_a uuid, p_b uuid, p_lane text)
returns uuid language plpgsql security definer set search_path = public as $$
declare lo uuid := least(p_a, p_b); hi uuid := greatest(p_a, p_b); cid uuid;
begin
  insert into public.st_chats (a_id, b_id, lane) values (lo, hi, p_lane)
  on conflict (a_id, b_id) do update set last_at = now() returning id into cid;
  return cid;
end $$;

create or replace function public.st_wave(p_hello uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); h public.st_hellos; cid uuid;
begin
  select * into h from public.st_hellos where id = p_hello and to_id = u and status = 'open' and expires_at > now();
  if h.id is null then raise exception 'not_found'; end if;
  update public.st_hellos set status = 'waved' where id = h.id;
  cid := public.st_open_chat(h.from_id, h.to_id, h.lane);
  insert into public.st_notify_queue (user_id, kind, ref) values (h.from_id, 'wave', cid);
  return jsonb_build_object('chatId', cid);
end $$;

create or replace function public.st_reply(p_hello uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); h public.st_hellos; cid uuid; b text := btrim(coalesce(p_body, ''));
begin
  if length(b) < 1 or length(b) > 1000 then raise exception 'bad_message'; end if;
  select * into h from public.st_hellos where id = p_hello and to_id = u and status in ('open','waved') and expires_at > now();
  if h.id is null then raise exception 'not_found'; end if;
  update public.st_hellos set status = 'replied' where id = h.id;
  cid := public.st_open_chat(h.from_id, h.to_id, h.lane);
  insert into public.st_messages (chat_id, from_id, body) values (cid, u, b);
  insert into public.st_notify_queue (user_id, kind, ref) values (h.from_id, 'message', cid);
  return jsonb_build_object('chatId', cid);
end $$;

-- ---------------------------------------------------------------- inbox

create or replace function public.st_inbox()
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid();
begin
  return jsonb_build_object(
    'received', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'lane', h.lane, 'note', h.note, 'createdAt', h.created_at, 'from', public.st_card(p, u)) order by h.created_at desc)
      from public.st_hellos h join public.st_profiles p on p.user_id = h.from_id
      where h.to_id = u and h.status = 'open' and h.expires_at > now() and not public.st_excluded(u, h.from_id)
    ), '[]'::jsonb),
    -- sent his: only the ones that are still open (no "expired" state, ever)
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'toId', h.to_id, 'firstName', p.first_name, 'createdAt', h.created_at) order by h.created_at desc)
      from public.st_hellos h join public.st_profiles p on p.user_id = h.to_id
      where h.from_id = u and h.status = 'open' and h.expires_at > now()
    ), '[]'::jsonb),
    'chats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'lane', c.lane, 'lastAt', c.last_at,
        'other', public.st_card(p, u),
        'last', (select jsonb_build_object('body', m.body, 'fromMe', m.from_id = u, 'at', m.created_at) from public.st_messages m where m.chat_id = c.id and (not m.held or m.from_id = u) order by m.created_at desc limit 1)
      ) order by c.last_at desc)
      from public.st_chats c join public.st_profiles p on p.user_id = case when c.a_id = u then c.b_id else c.a_id end
      where (c.a_id = u or c.b_id = u) and not exists (select 1 from public.st_blocks b where (b.user_id = u and b.other_id = p.user_id) or (b.user_id = p.user_id and b.other_id = u))
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- chat

create or replace function public.st_chat_member(p_chat uuid, u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.st_chats c where c.id = p_chat and (c.a_id = u or c.b_id = u))
$$;

create or replace function public.st_chat(p_chat uuid, p_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); c public.st_chats; other uuid;
begin
  select * into c from public.st_chats where id = p_chat;
  if c.id is null or not (c.a_id = u or c.b_id = u) then raise exception 'not_found'; end if;
  other := case when c.a_id = u then c.b_id else c.a_id end;
  return jsonb_build_object(
    'id', c.id, 'lane', c.lane,
    'other', (select public.st_card(p, u) from public.st_profiles p where p.user_id = other),
    'blocked', exists (select 1 from public.st_blocks b where (b.user_id = u and b.other_id = other) or (b.user_id = other and b.other_id = u)),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fromMe', m.from_id = u, 'body', m.body, 'held', m.held, 'at', m.created_at) order by m.created_at)
        from public.st_messages m where m.chat_id = c.id and (not m.held or m.from_id = u) and (p_since is null or m.created_at > p_since)), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'questionId', k.question_id, 'question', k.question,
        'mine', k.answers ->> u::text, 'theirs', case when k.revealed_at is not null then k.answers ->> other::text end,
        'revealed', k.revealed_at is not null, 'at', k.created_at) order by k.created_at)
        from public.st_cards k where k.chat_id = c.id), '[]'::jsonb),
    'meets', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.proposer_id = u, 'kind', m.kind, 'planId', m.plan_id, 'place', m.place, 'at', m.at,
        'status', m.status, 'myAfter', m.after ->> u::text, 'createdAt', m.created_at) order by m.created_at)
        from public.st_meets m where m.chat_id = c.id), '[]'::jsonb)
  );
end $$;

create or replace function public.st_send(p_chat uuid, p_body text, p_held boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); b text := btrim(coalesce(p_body, '')); c public.st_chats; m public.st_messages; other uuid;
begin
  if length(b) < 1 or length(b) > 1000 then raise exception 'bad_message'; end if;
  select * into c from public.st_chats where id = p_chat;
  if c.id is null or not (c.a_id = u or c.b_id = u) then raise exception 'not_found'; end if;
  other := case when c.a_id = u then c.b_id else c.a_id end;
  if exists (select 1 from public.st_blocks bl where (bl.user_id = u and bl.other_id = other) or (bl.user_id = other and bl.other_id = u)) then raise exception 'blocked'; end if;
  if (select count(*) from public.st_messages where from_id = u and created_at > now() - interval '1 hour') >= 120 then raise exception 'slow_down'; end if;
  insert into public.st_messages (chat_id, from_id, body, held) values (c.id, u, b, coalesce(p_held, false)) returning * into m;
  update public.st_chats set last_at = now() where id = c.id;
  if not m.held then insert into public.st_notify_queue (user_id, kind, ref) values (other, 'message', c.id); end if;
  return jsonb_build_object('id', m.id, 'at', m.created_at, 'held', m.held);
end $$;

-- moderator or the moderation function releases/keeps a held message
create or replace function public.st_hold(p_message uuid, p_held boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.st_is_mod() then raise exception 'not_mod'; end if;
  update public.st_messages set held = p_held where id = p_message;
end $$;

-- cards: deal (either member), answer (each privately), reveal when both answered
create or replace function public.st_card_deal(p_chat uuid, p_question_id text, p_question text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); k public.st_cards;
begin
  if not public.st_chat_member(p_chat, u) then raise exception 'not_found'; end if;
  if exists (select 1 from public.st_cards where chat_id = p_chat and revealed_at is null) then raise exception 'card_open'; end if;
  insert into public.st_cards (chat_id, question_id, question) values (p_chat, left(p_question_id, 16), public.st_clean(p_question, 240)) returning * into k;
  update public.st_chats set last_at = now() where id = p_chat;
  return jsonb_build_object('id', k.id);
end $$;

create or replace function public.st_card_answer(p_card uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); k public.st_cards; c public.st_chats; a text := btrim(coalesce(p_answer, '')); other uuid;
begin
  if length(a) < 1 or length(a) > 280 then raise exception 'bad_answer'; end if;
  select * into k from public.st_cards where id = p_card;
  if k.id is null then raise exception 'not_found'; end if;
  select * into c from public.st_chats where id = k.chat_id;
  if not (c.a_id = u or c.b_id = u) then raise exception 'not_found'; end if;
  other := case when c.a_id = u then c.b_id else c.a_id end;
  update public.st_cards set answers = answers || jsonb_build_object(u::text, a),
    revealed_at = case when answers ? other::text then now() else revealed_at end
    where id = k.id returning * into k;
  update public.st_chats set last_at = now() where id = c.id;
  return jsonb_build_object('revealed', k.revealed_at is not null);
end $$;

-- ---------------------------------------------------------------- plans (Small Talk's own "I'm in"; see PLANS-CONTRACT.md)

create or replace function public.st_plan_join(p_plan text, p_show_name boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into public.st_plan_members (plan_id, user_id, show_name) values (left(p_plan, 80), public.st_uid(), coalesce(p_show_name, false))
  on conflict (plan_id, user_id) do update set show_name = excluded.show_name;
$$;

create or replace function public.st_plan_leave(p_plan text)
returns void language sql security definer set search_path = public as $$
  delete from public.st_plan_members where plan_id = p_plan and user_id = public.st_uid();
$$;

-- counts for everyone (anon too); names only for signed-in members, only for people who opted in
create or replace function public.st_plan_people(p_plans text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  return coalesce((
    select jsonb_object_agg(pid, jsonb_build_object(
      'count', (select count(*) from public.st_plan_members pm where pm.plan_id = pid),
      'names', case when u is null then '[]'::jsonb else coalesce((
        select jsonb_agg(p.first_name) from public.st_plan_members pm join public.st_profiles p on p.user_id = pm.user_id
        where pm.plan_id = pid and pm.show_name and not public.st_excluded(u, pm.user_id) and pm.user_id <> u), '[]'::jsonb) end,
      'mine', u is not null and exists (select 1 from public.st_plan_members pm where pm.plan_id = pid and pm.user_id = u)
    ))
    from unnest(p_plans) pid
  ), '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- meets / after

create or replace function public.st_meet_propose(p_chat uuid, p_kind text, p_plan text default null, p_place jsonb default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); c public.st_chats; m public.st_meets; other uuid;
begin
  select * into c from public.st_chats where id = p_chat;
  if c.id is null or not (c.a_id = u or c.b_id = u) then raise exception 'not_found'; end if;
  if p_kind not in ('plan','place','standing') then raise exception 'bad_meet'; end if;
  other := case when c.a_id = u then c.b_id else c.a_id end;
  insert into public.st_meets (chat_id, proposer_id, kind, plan_id, place, at)
  values (c.id, u, p_kind, left(p_plan, 80), case when p_place is null then null else jsonb_build_object('name', public.st_clean(p_place ->> 'name', 60), 'neighborhood', left(p_place ->> 'neighborhood', 40), 'why', public.st_clean(p_place ->> 'why', 80)) end, p_at)
  returning * into m;
  update public.st_chats set last_at = now() where id = c.id;
  insert into public.st_notify_queue (user_id, kind, ref) values (other, 'meet', c.id);
  return jsonb_build_object('id', m.id);
end $$;

create or replace function public.st_meet_respond(p_meet uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); m public.st_meets; c public.st_chats;
begin
  select * into m from public.st_meets where id = p_meet;
  if m.id is null then raise exception 'not_found'; end if;
  select * into c from public.st_chats where id = m.chat_id;
  if not (c.a_id = u or c.b_id = u) or m.proposer_id = u or m.status <> 'proposed' then raise exception 'not_found'; end if;
  update public.st_meets set status = case when p_accept then 'accepted' else 'declined' end where id = m.id;
  if p_accept then
    update public.st_profiles set confirmed_meets = confirmed_meets + 1 where user_id in (c.a_id, c.b_id);
    insert into public.st_notify_queue (user_id, kind, ref) values (m.proposer_id, 'meet_accepted', c.id);
  end if;
  update public.st_chats set last_at = now() where id = c.id;
  return jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end);
end $$;

-- private one-tap after: good / fine / report. "report" opens a report row too.
create or replace function public.st_after(p_meet uuid, p_verdict text)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid(); m public.st_meets; c public.st_chats; other uuid;
begin
  if p_verdict not in ('good','fine','report') then raise exception 'bad_after'; end if;
  select * into m from public.st_meets where id = p_meet;
  if m.id is null or m.status not in ('accepted','done') then raise exception 'not_found'; end if;
  select * into c from public.st_chats where id = m.chat_id;
  if not (c.a_id = u or c.b_id = u) then raise exception 'not_found'; end if;
  other := case when c.a_id = u then c.b_id else c.a_id end;
  if not (m.after ? u::text) then
    update public.st_meets set after = after || jsonb_build_object(u::text, p_verdict), status = 'done' where id = m.id;
    if p_verdict in ('good','fine') then update public.st_profiles set showed_meets = showed_meets + 1 where user_id = other; end if;
    if p_verdict = 'report' then
      insert into public.st_reports (from_id, about_id, reason, detail, ref) values (u, other, 'unsafe', 'after-meet check-in', 'meet:' || m.id::text);
      perform public.st_apply_reports(other);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- block / hide / report

create or replace function public.st_block(p_other uuid, p_kind text default 'block')
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid();
begin
  if p_kind not in ('block','hide') then p_kind := 'block'; end if;
  insert into public.st_blocks (user_id, other_id, kind) values (u, p_other, p_kind) on conflict (user_id, other_id) do update set kind = excluded.kind;
  -- a block silently drops any open hi either way
  update public.st_hellos set status = 'passed' where (from_id = u and to_id = p_other) or (from_id = p_other and to_id = u);
end $$;

create or replace function public.st_unblock(p_other uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.st_blocks where user_id = public.st_uid() and other_id = p_other;
$$;

create or replace function public.st_apply_reports(p_about uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(distinct from_id) into n from public.st_reports where about_id = p_about and resolved_at is null;
  update public.st_profiles set reports = n, suppressed = (n >= 2) or suppressed where user_id = p_about;
end $$;

create or replace function public.st_report(p_about uuid, p_reason text, p_detail text default '', p_ref text default '')
returns void language plpgsql security definer set search_path = public as $$
declare u uuid := public.st_uid();
begin
  if p_reason not in ('fake','harassment','unsafe','minor','other') then raise exception 'bad_report'; end if;
  if p_about = u then raise exception 'bad_report'; end if;
  if (select count(*) from public.st_reports where from_id = u and created_at > now() - interval '1 day') >= 10 then raise exception 'slow_down'; end if;
  insert into public.st_reports (from_id, about_id, reason, detail, ref) values (u, p_about, p_reason, public.st_clean(p_detail, 500), left(coalesce(p_ref, ''), 80));
  -- a report about a minor suppresses immediately, on one report
  if p_reason = 'minor' then update public.st_profiles set suppressed = true where user_id = p_about; end if;
  perform public.st_apply_reports(p_about);
  perform public.st_block(p_about, 'block');
end $$;

-- ---------------------------------------------------------------- push / delete

create or replace function public.st_push_save(p_endpoint text, p_keys jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.st_push_subs (user_id, endpoint, keys) values (public.st_uid(), left(p_endpoint, 1000), p_keys)
  on conflict (user_id, endpoint) do update set keys = excluded.keys;
$$;

create or replace function public.st_push_remove(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.st_push_subs where user_id = public.st_uid() and endpoint = p_endpoint;
$$;

-- Delete everything. Really. Cascades take profile, intent, photos rows, his,
-- chats I'm in (and their messages), plan memberships, blocks, reports I made,
-- push subs, the queue — and the auth user itself. Storage objects are
-- removed by the client before calling this (and by the nightly sweep).
create or replace function public.st_delete_me()
returns void language plpgsql security definer set search_path = public, auth as $$
declare u uuid := public.st_uid();
begin
  delete from public.st_chats where a_id = u or b_id = u;
  delete from auth.users where id = u;
end $$;

-- ---------------------------------------------------------------- moderator back room

create or replace function public.st_mod_queue()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.st_is_mod() then raise exception 'not_mod'; end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'reason', r.reason, 'detail', r.detail, 'ref', r.ref, 'createdAt', r.created_at,
        'about', jsonb_build_object('id', p.user_id, 'firstName', p.first_name, 'reports', p.reports, 'suppressed', p.suppressed, 'banned', p.banned),
        'from', (select jsonb_build_object('id', q.user_id, 'firstName', q.first_name) from public.st_profiles q where q.user_id = r.from_id)) order by r.created_at desc)
        from public.st_reports r join public.st_profiles p on p.user_id = r.about_id where r.resolved_at is null), '[]'::jsonb),
    'held', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'createdAt', m.created_at, 'chatId', m.chat_id,
        'from', (select jsonb_build_object('id', q.user_id, 'firstName', q.first_name) from public.st_profiles q where q.user_id = m.from_id)) order by m.created_at desc)
        from public.st_messages m where m.held), '[]'::jsonb),
    'suppressed', coalesce((select jsonb_agg(jsonb_build_object('id', p.user_id, 'firstName', p.first_name, 'reports', p.reports, 'createdAt', p.created_at) order by p.created_at desc)
        from public.st_profiles p where p.suppressed and not p.banned), '[]'::jsonb),
    'ratio', public.st_mod_ratio()
  );
end $$;

-- the gender-balance dashboard: dating-lane membership and 7-day reply rates by gender
create or replace function public.st_mod_ratio()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.st_is_mod() then raise exception 'not_mod'; end if;
  return jsonb_build_object(
    'members', (select count(*) from public.st_profiles where not banned),
    'datingOpen', coalesce((select jsonb_object_agg(gender, n) from (select gender, count(*) n from public.st_intents where dating_open group by gender) g), '{}'::jsonb),
    'datingHis7d', coalesce((select jsonb_object_agg(g, n) from (select i.gender g, count(*) n from public.st_hellos h join public.st_intents i on i.user_id = h.from_id where h.lane = 'dating' and h.created_at > now() - interval '7 days' group by i.gender) x), '{}'::jsonb),
    'datingReplied7d', coalesce((select jsonb_object_agg(g, n) from (select i.gender g, count(*) n from public.st_hellos h join public.st_intents i on i.user_id = h.to_id where h.lane = 'dating' and h.status in ('waved','replied') and h.created_at > now() - interval '7 days' group by i.gender) x), '{}'::jsonb)
  );
end $$;

create or replace function public.st_mod_act(p_kind text, p_id text, p_action text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.st_is_mod() then raise exception 'not_mod'; end if;
  if p_kind = 'report' then
    update public.st_reports set resolved_at = now(), resolution = p_action where id = p_id::uuid;
    perform public.st_apply_reports((select about_id from public.st_reports where id = p_id::uuid));
  elsif p_kind = 'profile' then
    if p_action = 'restore' then update public.st_profiles set suppressed = false, reports = 0 where user_id = p_id::uuid;
      update public.st_reports set resolved_at = now(), resolution = 'dismissed' where about_id = p_id::uuid and resolved_at is null;
    elsif p_action = 'suppress' then update public.st_profiles set suppressed = true where user_id = p_id::uuid;
    elsif p_action = 'ban' then update public.st_profiles set banned = true, suppressed = true where user_id = p_id::uuid;
      update public.st_reports set resolved_at = now(), resolution = 'banned' where about_id = p_id::uuid and resolved_at is null;
    else raise exception 'bad_action'; end if;
  elsif p_kind = 'message' then
    if p_action = 'release' then update public.st_messages set held = false where id = p_id::uuid;
    elsif p_action = 'delete' then delete from public.st_messages where id = p_id::uuid;
    else raise exception 'bad_action'; end if;
  else raise exception 'bad_kind'; end if;
end $$;

-- ---------------------------------------------------------------- grants

-- lock down ONLY st_* functions (other apps share this schema — never touch theirs)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'st\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.st_public_stats(), public.st_plan_people(text[]) to anon, authenticated;
grant execute on function
  public.st_me(), public.st_save_profile(jsonb), public.st_set_visible(boolean), public.st_set_intent(jsonb),
  public.st_set_photo(int, text, text), public.st_remove_photo(int),
  public.st_browse(text, text, timestamptz), public.st_hi(uuid, text, text), public.st_pass(uuid), public.st_hi_pass(uuid),
  public.st_wave(uuid), public.st_reply(uuid, text), public.st_inbox(), public.st_chat(uuid, timestamptz), public.st_send(uuid, text, boolean),
  public.st_card_deal(uuid, text, text), public.st_card_answer(uuid, text),
  public.st_plan_join(text, boolean), public.st_plan_leave(text),
  public.st_meet_propose(uuid, text, text, jsonb, timestamptz), public.st_meet_respond(uuid, boolean), public.st_after(uuid, text),
  public.st_block(uuid, text), public.st_unblock(uuid), public.st_report(uuid, text, text, text),
  public.st_push_save(text, jsonb), public.st_push_remove(text), public.st_delete_me(),
  public.st_hold(uuid, boolean), public.st_mod_queue(), public.st_mod_ratio(), public.st_mod_act(text, text, text)
  to authenticated;

-- realtime for messages + cards (the two tables with a SELECT policy)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.st_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.st_cards; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------- storage bucket (photos)
-- Private bucket; signed-in members read via signed URLs; owners write their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('st-photos', 'st-photos', false, 2500000, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2500000, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists st_photos_read on storage.objects;
create policy st_photos_read on storage.objects for select to authenticated using (bucket_id = 'st-photos');
drop policy if exists st_photos_write on storage.objects;
create policy st_photos_write on storage.objects for insert to authenticated with check (bucket_id = 'st-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists st_photos_update on storage.objects;
create policy st_photos_update on storage.objects for update to authenticated using (bucket_id = 'st-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists st_photos_delete on storage.objects;
create policy st_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'st-photos' and (storage.foldername(name))[1] = auth.uid()::text);
