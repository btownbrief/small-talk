# Plans contract — Up For It ⇄ Small Talk

Two apps, one Supabase project (`jnouvwxomrcffqwilqkq`), **no shared identity,
no shared email list.** Up For It owns the plans state machine
(wish → tipped → claimed → dated → happened). Small Talk is a read-only
consumer at the `dated` boundary. This file is the whole interface; if you
change it, change it here first and tell the other repo.

## What Up For It exposes (owner: Up For It, repo ~/btownbrief/up-for-it)

One anon-callable RPC, `uf_plans_public()` (no args; agreed 2026-08-23 between
the two sessions; the Up For It README is canonical). Returns a jsonb array of
`{ id (uuid, stable), idea_id, title, place, detail, category, starts_at
(ISO | null = needs a date), cap, threshold, status, host_name (FIRST NAME
ONLY), in_count, wait_count, meetup_url ("" | https), created_at, tipped_at,
showed (int | null, on done rows) }`.
Status values: `tipping` (never shown in Small Talk) · `on` (+ starts_at =
our "dated") · `done` (our "happened") · `cancelled` (skip).
Their category ids: outdoors, food-drink, games, music, arts, learning,
wellness, sports, community, social, words, film → Small Talk maps
outdoors/sports→trails, games, music; the rest show in Plans without a tab
(`UF_CATEGORY_TO_TAB` in js/core.js).

Rules (doctrine, from the joint review 2026-08-23):
- **Plans travel as a place and a time.** `host_name` is a first name only;
  `in_count` is a COUNT, never who. No joiner's name, email, or token ever.
- Small Talk SHOWS only `on`+dated and `done` rows. It must never surface or
  push a tip — a dating-app "I'm in" on a tipping plan would make the
  threshold theatre.
- `id` must be stable across edits so Small Talk can key "I'm in" to it.

## What Small Talk does with it (owner: Small Talk)

- The client calls `uf_plans_public()` directly (anon) and merges the
  dated/happened rows with the events-sourced plans in `data/plans.json`
  (built nightly from guide.btownbrief.com events.json). If the RPC doesn't
  exist yet (404), Small Talk works fine without it.
- "I'm in" inside Small Talk writes ONLY to Small Talk's own `st_plan_members`
  (keyed by the plan `id` text). It never writes into Up For It. Members who
  want a seat RSVP as humans through `url`. Small Talk shows "N from here are
  going" as a count, and first names only to signed-in Small Talk members who
  opted in per plan.
- "Go together" = two Small Talk members coordinate in chat and each RSVP via
  `url`. Small Talk never reserves seats; Up For It's cap is its own.
- Small Talk **never** contributes to a tip, never reads wishes, never sends
  anything to an Up For It email.

## Attendance (owner: Up For It)

Hosts mark "happened · N came" in the Host Desk; that `showed` count rides on
`done` rows of the same RPC. Small Talk does not write anything back. (The
optional write-back function discussed in review was declined — not needed.)

## Two steals agreed in the joint review

- Up For It ← Small Talk: require **one typed line at "I'm in"** ("why you'd
  go") — it predicts attendance and gives the host something to read.
- Small Talk ← Up For It: a private **who-showed** signal used only to rank
  browse and weight reports, never rendered on a profile.
