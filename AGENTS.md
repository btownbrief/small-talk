# Small Talk — agent notes

Read `README.md` first. Stephen is non-technical — explain consequential
changes in plain language. Plain static site, no build step, ES modules.
Same Supabase project as the rest of the fleet; every object here is `st_*`.

## Rules that will trip you up

- **`js/core.js` is pure and that purity is the contract.** No DOM, no
  fetch, no `Date.now()` — time is an argument. Every rule there (lane
  visibility `canSee`, hi ≤140 + dating cap 5/week + 7-day expiry, profile
  shape, 2-report suppression, card reveal, meet options, Up For It status
  mapping) is mirrored one-for-one by `supabase/small-talk-SETUP.sql` and
  `js/fake-backend.js`. **Change all three together** and add a case to
  `scripts/test-core.mjs` + `scripts/sql-smoke.sql`.
- **Intent is private and that is load-bearing.** `st_intents` is never
  joined into anything a client can read about someone else. `st_card()` is
  the only public projection of a profile — never add gender/seeking/
  dating_open to it. The playtest asserts `datingOpen` never appears in the
  DOM of the people tab.
- **Small-town deniability.** Passes are stored only for the passer (RLS).
  "Not now" on a received hi flips it to `passed` and the sender is told
  nothing. No read receipts. `st_inbox().sent` lists only still-open hi's —
  never render an "expired" state.
- **Plans travel as a place and a time** (PLANS-CONTRACT.md). Small Talk
  reads `uf_plans_public()` and shows only `on`+dated / `done` rows (never
  `tipping`), writes nothing into `uf_*`, and never shares identity or email
  with Up For It. "I'm in" lives in `st_plan_members`; people RSVP via the
  plan's `url` as humans.
- **Wingperson, never ghostwriter.** "Stuck?" deals a card from
  `data/questions.json` or shows a self-prompt (`SELF_PROMPTS`). Do not add
  anything that analyzes or summarizes the other person.
- **Text-only chat.** No photo/file sending. Photos are profile-only, 1–3,
  re-encoded to JPEG client-side (`shrink()` strips EXIF/GPS), private
  bucket `st-photos`, signed URLs for signed-in members only. The
  `st-moderate` function deletes flagged uploads.
- **Nothing permanent without a human.** Two reports = `suppressed` (hidden
  from browse, chats still work); `minor` = one report. Only `mod.html`
  (`st_is_mod()` by email in `st_mods`) can restore/ban/release/delete.
  `st_delete_me()` is the one exception — the user deleting themselves.
- **Fail soft.** Every optional piece (SQL, edge functions, Resend, VAPID,
  Up For It RPC) degrades to "still works, less happens." Keep it that way.
  `?demo=1` must keep passing `scripts/playtest.mjs`.
- **Design doctrine:** people are the home screen; four tab chips are the
  only filter; new facets go on the card or in a sheet, not a new control.
  City Guide materials (paper/navy/teal, Instrument Serif + DM Sans), dark
  mode by tokens only, `[hidden]` wins.
- **The gender ratio is the app-killer.** `st_mod_ratio()` + `ratioStatus()`
  exist so it's visible. If the dating lane passes ~70/30, the right move is
  pausing new signups on the heavy side, not a feature.

## Before you finish

```
node --test scripts/test-core.mjs
for f in js/*.js sw.js; do node --check "$f"; done
./scripts/sql-check.sh
NODE_PATH=<dir with playwright> node scripts/playtest.mjs
```
