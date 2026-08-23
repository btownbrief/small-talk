-- End-to-end smoke of the st_* RPCs on the scratch DB (see sql-check.sh).
\set ON_ERROR_STOP on
create or replace function pg_temp.as_user(u text, e text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'email', e)::text, false) $$;
create or replace function pg_temp.expect_error(sql text, code text) returns void language plpgsql as $$
begin
  begin execute sql; raise exception 'expected % but succeeded: %', code, sql;
  exception when others then
    if sqlerrm <> code then raise exception 'expected % got % for %', code, sqlerrm, sql; end if;
  end;
end $$;
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','maya@example.com'),
  ('22222222-2222-2222-2222-222222222222','sam@example.com'),
  ('33333333-3333-3333-3333-333333333333','stephenvdavis@gmail.com'),
  ('44444444-4444-4444-4444-444444444444','kid@example.com');

-- Maya: profile + dating open, seeking men
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
select public.st_save_profile('{"firstName":"Maya","birthYear":1995,"neighborhood":"one","tabs":["trails","music"],"prompts":[{"id":"weekend","a":"Camel''s Hump in any weather visit www.spam.com"},{"id":"lately","a":"sourdough"}]}');
select pg_temp.expect_error($$select public.st_save_profile('{"firstName":"Kid","birthYear":2012,"neighborhood":"one","prompts":[{"id":"weekend","a":"x"},{"id":"lately","a":"y"}]}')$$, 'too_young');
select pg_temp.expect_error($$select public.st_save_profile('{"firstName":"Maya","birthYear":1995,"neighborhood":"one","prompts":[{"id":"weekend","a":"x"}]}')$$, 'bad_profile');
select public.st_set_intent('{"datingOpen":true,"gender":"woman","seeking":["man"]}');
select public.st_set_photo(0, '11111111-1111-1111-1111-111111111111/0.jpg');
select pg_temp.expect_error($$select public.st_set_photo(0, '22222222-2222-2222-2222-222222222222/0.jpg')$$, 'bad_photo');
do $$ declare me jsonb := public.st_me(); begin
  if me -> 'profile' ->> 'firstName' <> 'Maya' then raise exception 'me name'; end if;
  if (me -> 'profile' -> 'prompts' -> 0 ->> 'a') like '%spam%' then raise exception 'url not stripped'; end if;
  if (me -> 'intent' ->> 'datingOpen')::boolean is not true then raise exception 'intent'; end if;
end $$;

-- Sam: profile, dating open, man seeking women
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
select public.st_save_profile('{"firstName":"Sam","birthYear":1990,"neighborhood":"downtown","tabs":["games","trails"],"prompts":[{"id":"order","a":"Dobra, always"},{"id":"teach","a":"cribbage"}]}');
select public.st_set_intent('{"datingOpen":true,"gender":"man","seeking":["woman"]}');
select public.st_set_photo(0, '22222222-2222-2222-2222-222222222222/0.jpg');
-- Stephen: friends only (no intent)
select pg_temp.as_user('33333333-3333-3333-3333-333333333333','stephenvdavis@gmail.com');
select public.st_save_profile('{"firstName":"Stephen","birthYear":1992,"neighborhood":"south-end","tabs":["games"],"prompts":[{"id":"weekend","a":"coffee with 30 people"},{"id":"argue","a":"creemees > ice cream"}]}');
select public.st_set_photo(0, '33333333-3333-3333-3333-333333333333/0.jpg');

-- browse: friends lane shows both; dating lane (Sam) shows Maya only; Stephen can't browse dating
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
do $$ declare f jsonb := public.st_browse('friends'); d jsonb := public.st_browse('dating'); begin
  if jsonb_array_length(f) <> 2 then raise exception 'friends browse %', f; end if;
  if jsonb_array_length(d) <> 1 or d -> 0 ->> 'firstName' <> 'Maya' then raise exception 'dating browse %', d; end if;
  if d -> 0 ? 'intent' or d -> 0 ? 'gender' then raise exception 'intent leaked'; end if;
  if jsonb_array_length(public.st_browse('friends', 'music')) <> 1 then raise exception 'tab filter'; end if;
end $$;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333','stephenvdavis@gmail.com');
do $$ begin if jsonb_array_length(public.st_browse('dating')) <> 0 then raise exception 'stephen sees dating'; end if; end $$;

-- hi: Sam → Maya in dating lane; cap at 5/week; can't hi someone you can't see
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
select public.st_hi('11111111-1111-1111-1111-111111111111', 'dating', 'fellow any-weather hiker — worst summit you''ve been on? http://x.com');
select pg_temp.expect_error($$select public.st_hi('11111111-1111-1111-1111-111111111111', 'dating', 'again')$$, 'already_said_hi');
select pg_temp.expect_error($$select public.st_hi('33333333-3333-3333-3333-333333333333', 'dating', 'hey')$$, 'not_found');
select pg_temp.expect_error($$select public.st_hi('22222222-2222-2222-2222-222222222222', 'friends', 'me')$$, 'not_found');
do $$ declare me jsonb := public.st_me(); begin if (me ->> 'datingHiRemaining')::int <> 4 then raise exception 'remaining %', me ->> 'datingHiRemaining'; end if; end $$;
-- simulate cap: insert 4 more dating his to fake users
insert into auth.users select gen_random_uuid(), 'x'||g||'@e.com' from generate_series(1,4) g;
insert into public.st_hellos (from_id, to_id, lane, note) select '22222222-2222-2222-2222-222222222222', id, 'dating', 'x' from auth.users where email like 'x%@e.com';
select public.st_hi('33333333-3333-3333-3333-333333333333', 'friends', 'cribbage at Dobra sometime?');  -- friends lane is not capped
do $$ declare me jsonb := public.st_me(); begin if (me ->> 'datingHiRemaining')::int <> 0 then raise exception 'remaining2 %', me ->> 'datingHiRemaining'; end if; end $$;
select pg_temp.expect_error($$select public.st_hi('11111111-1111-1111-1111-111111111111', 'dating', 'x')$$, 'dating_cap');
delete from public.st_hellos where to_id in (select id from auth.users where email like 'x%@e.com');
update public.st_hellos set status = 'open' where from_id = '22222222-2222-2222-2222-222222222222' and to_id = '11111111-1111-1111-1111-111111111111';

-- Maya's inbox: one hi from Sam, note URL-stripped; wave opens a chat
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
do $$ declare ib jsonb := public.st_inbox(); begin
  if jsonb_array_length(ib -> 'received') <> 1 then raise exception 'inbox %', ib; end if;
  if (ib -> 'received' -> 0 ->> 'note') like '%x.com%' then raise exception 'hi url'; end if;
  if ib -> 'received' -> 0 -> 'from' ->> 'firstName' <> 'Sam' then raise exception 'from'; end if;
end $$;
create temp table t as select (public.st_wave((select id from public.st_hellos where from_id = '22222222-2222-2222-2222-222222222222' and to_id = '11111111-1111-1111-1111-111111111111')) ->> 'chatId')::uuid as chat;
do $$ declare c uuid := (select chat from t); r jsonb; begin
  r := public.st_send(c, 'Mansfield in sideways rain. Zero regrets, one lost hat.');
  if (r ->> 'held')::boolean then raise exception 'held'; end if;
  r := public.st_card_deal(c, 'q001', 'Church Street or the waterfront?');
  perform public.st_card_answer((r ->> 'id')::uuid, 'Waterfront, obviously');
  if (public.st_chat(c) -> 'cards' -> 0 ->> 'revealed')::boolean then raise exception 'revealed early'; end if;
  if public.st_chat(c) -> 'cards' -> 0 ->> 'theirs' is not null then raise exception 'theirs leaked'; end if;
end $$;
-- Sam answers → revealed; proposes a meet; Maya accepts; both After
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
do $$ declare c uuid := (select chat from t); k uuid; m jsonb; begin
  k := (public.st_chat(c) -> 'cards' -> 0 ->> 'id')::uuid;
  perform public.st_card_answer(k, 'Church Street in December, waterfront otherwise');
  if not (public.st_chat(c) -> 'cards' -> 0 ->> 'revealed')::boolean then raise exception 'not revealed'; end if;
  if public.st_chat(c) -> 'cards' -> 0 ->> 'theirs' <> 'Waterfront, obviously' then raise exception 'theirs'; end if;
  if jsonb_array_length(public.st_chat(c) -> 'messages') <> 1 then raise exception 'msgs'; end if;
  m := public.st_meet_propose(c, 'place', null, '{"name":"Dobra Tea","neighborhood":"Downtown","why":"quiet"}', now() + interval '2 days');
  perform set_config('st.meet', m ->> 'id', false);
end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
select public.st_meet_respond(current_setting('st.meet')::uuid, true);
select public.st_after(current_setting('st.meet')::uuid, 'good');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
select public.st_after(current_setting('st.meet')::uuid, 'fine');
do $$ declare p record; begin
  select * into p from public.st_profiles where user_id = '11111111-1111-1111-1111-111111111111';
  if p.confirmed_meets <> 1 or p.showed_meets <> 1 then raise exception 'reliability % %', p.confirmed_meets, p.showed_meets; end if;
end $$;

-- plans: I'm in (count for anon, names only when opted in)
select public.st_plan_join('ev:abc', true);
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
select public.st_plan_join('ev:abc', false);
do $$ declare r jsonb := public.st_plan_people(array['ev:abc','ev:none']); begin
  if (r -> 'ev:abc' ->> 'count')::int <> 2 then raise exception 'count %', r; end if;
  if r -> 'ev:abc' -> 'names' <> '["Sam"]'::jsonb then raise exception 'names %', r; end if;
  if not (r -> 'ev:abc' ->> 'mine')::boolean then raise exception 'mine'; end if;
end $$;
select set_config('request.jwt.claims', '', false);
do $$ declare r jsonb := public.st_plan_people(array['ev:abc']); s jsonb := public.st_public_stats(); begin
  if r -> 'ev:abc' -> 'names' <> '[]'::jsonb then raise exception 'anon names %', r; end if;
  if (s ->> 'members')::int <> 3 then raise exception 'stats %', s; end if;
  if s -> 'fragments' -> 0 ? 'firstName' then raise exception 'fragment leak'; end if;
end $$;
select pg_temp.expect_error($$select public.st_me()$$, 'not_signed_in');

-- reports: two distinct reporters suppress; minor suppresses on one; mod restores; non-mod blocked
select pg_temp.as_user('44444444-4444-4444-4444-444444444444','kid@example.com');
select public.st_save_profile('{"firstName":"Kid","birthYear":2000,"neighborhood":"hill","prompts":[{"id":"weekend","a":"a"},{"id":"lately","a":"b"}]}');
select public.st_set_photo(0, '44444444-4444-4444-4444-444444444444/0.jpg');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
select public.st_report('44444444-4444-4444-4444-444444444444', 'harassment', 'rude');
do $$ begin if (select suppressed from public.st_profiles where user_id = '44444444-4444-4444-4444-444444444444') then raise exception 'suppressed on 1'; end if; end $$;
select pg_temp.expect_error($$select public.st_mod_queue()$$, 'not_mod');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
select public.st_report('44444444-4444-4444-4444-444444444444', 'fake', '');
do $$ begin if not (select suppressed from public.st_profiles where user_id = '44444444-4444-4444-4444-444444444444') then raise exception 'not suppressed on 2'; end if; end $$;
-- reporter auto-blocks: Sam no longer sees Kid; Kid not in Stephen's browse either (suppressed)
select pg_temp.as_user('33333333-3333-3333-3333-333333333333','stephenvdavis@gmail.com');
do $$ declare q jsonb := public.st_mod_queue(); begin
  if jsonb_array_length(q -> 'reports') <> 2 then raise exception 'queue %', q; end if;
  if jsonb_array_length(q -> 'suppressed') <> 1 then raise exception 'suppressed list'; end if;
  if (q -> 'ratio' -> 'datingOpen' ->> 'woman')::int <> 1 then raise exception 'ratio %', q -> 'ratio'; end if;
  perform public.st_mod_act('profile', '44444444-4444-4444-4444-444444444444', 'restore');
  if jsonb_array_length(public.st_mod_queue() -> 'reports') <> 0 then raise exception 'restore did not resolve'; end if;
  if (select suppressed from public.st_profiles where user_id = '44444444-4444-4444-4444-444444444444') then raise exception 'still suppressed'; end if;
end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
select public.st_report('44444444-4444-4444-4444-444444444444', 'minor', 'looks 16');
do $$ begin if not (select suppressed from public.st_profiles where user_id = '44444444-4444-4444-4444-444444444444') then raise exception 'minor not suppressed'; end if; end $$;

-- held message: only the sender sees it; mod can release
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
do $$ declare c uuid := (select chat from t); r jsonb; begin
  r := public.st_send(c, 'this one is held', true);
  if jsonb_array_length(public.st_chat(c) -> 'messages') <> 2 then raise exception 'sender sees held'; end if;
  perform set_config('st.held', r ->> 'id', false);
end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
do $$ declare c uuid := (select chat from t); begin if jsonb_array_length(public.st_chat(c) -> 'messages') <> 1 then raise exception 'recipient sees held'; end if; end $$;
select pg_temp.as_user('33333333-3333-3333-3333-333333333333','stephenvdavis@gmail.com');
select public.st_mod_act('message', current_setting('st.held'), 'release');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
do $$ declare c uuid := (select chat from t); begin if jsonb_array_length(public.st_chat(c) -> 'messages') <> 2 then raise exception 'release failed'; end if; end $$;

-- block: chat send fails, browse hides both ways
select public.st_block('22222222-2222-2222-2222-222222222222', 'block');
select pg_temp.expect_error(format($$select public.st_send('%s', 'hello?')$$, (select chat from t)), 'blocked');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222','sam@example.com');
do $$ begin if jsonb_array_length(public.st_browse('dating')) <> 0 then raise exception 'blocked still visible'; end if; end $$;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111','maya@example.com');
select public.st_unblock('22222222-2222-2222-2222-222222222222');

-- pass: hides from my browse only
select public.st_pass('33333333-3333-3333-3333-333333333333');
do $$ begin if exists (select 1 from jsonb_array_elements(public.st_browse('friends')) e where e ->> 'firstName' = 'Stephen') then raise exception 'pass failed'; end if; end $$;

-- delete everything: user, profile, chats, memberships gone
select public.st_delete_me();
do $$ begin
  if exists (select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111') then raise exception 'user remains'; end if;
  if exists (select 1 from public.st_profiles where user_id = '11111111-1111-1111-1111-111111111111') then raise exception 'profile remains'; end if;
  if exists (select 1 from public.st_chats where a_id = '11111111-1111-1111-1111-111111111111' or b_id = '11111111-1111-1111-1111-111111111111') then raise exception 'chat remains'; end if;
  if exists (select 1 from public.st_plan_members where user_id = '11111111-1111-1111-1111-111111111111') then raise exception 'membership remains'; end if;
end $$;
\echo smoke: all assertions passed
