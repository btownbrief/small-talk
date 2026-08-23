# Small Talk

A Burlington-only way to meet people — friends, or more. One line instead of
an opener, a question card when you're stuck, and real plans in town.
Working title; the name is one constant (`APP_NAME` in `js/core.js`) plus copy.

Live (once Pages is on): https://play.btownbrief.com/small-talk/ · demo with
nothing saved: `?demo=1` · back room: `mod.html` (moderator sign-in only).

Spec and the design history (two Opus rounds + the cross-check with Up For
It) live in the claude.ai artifact "Small Talk Spec"; the short version is
in this README and in `AGENTS.md`.

## What it is, in one breath

- **People** is the home screen: cards (photo, first name, age, neighborhood,
  tabs, one prompt, "going to X Thursday"). **Say hi** with one required line
  (≤140). **Pass** is invisible. Four tab chips are the only filter.
- **Two lanes, one profile.** Friends is on for everyone. **Open to dating**
  is a private toggle — it routes who you see, it never shows on a card, and
  the dating lane caps hi's at five a week per person (the gender-balance
  lever). Gender / seeking are asked only for that lane and never shown.
- A hi can be **waved** at, **replied** to, or quietly **not-now'd** (sender
  is told nothing, ever; unanswered hi's expire silently after 7 days). Wave
  or reply opens a text-only **chat**. No read receipts.
- **Stuck?** in chat deals a **card** (question from the Stay Awhile deck —
  both answer privately, reveals when both are in) or a self-prompt. Nothing
  analyzes the other person for you.
- **Plans** = a place and a time, from the Btown Brief events feed
  (`data/plans.json`, nightly) + Up For It's `uf_plans_public()` (dated rows
  only). **I'm in** tells people here you're going (count, or first name if
  you opt in per plan); RSVPs happen wherever the plan lives.
- **Ready to meet?** proposes going to a plan together, a public place from
  `data/places.json`, or Saturday coffee (always last, never the frame).
  After: a private one-tap **how'd it go?** (good / fine / report).
- **Safety:** block, hide-me-from-them, report (2 reports → suppressed from
  browse pending a human; "minor" → 1), every message through OpenAI
  moderation (held messages visible only to the sender), moderator back
  room with AI-free triage and the dating-lane ratio, **Delete everything**
  that really deletes. See `about.html` for what Stephen can see and the
  incident protocol.

## Layout

```
index.html  about.html  mod.html  sw.js  manifest.webmanifest  icon.svg
css/style.css                       City Guide materials; dark by tokens
js/core.js                          PURE rules (mirrored by SQL + fake backend)
js/net.js                           supabase-js transport / ?demo=1 transport
js/fake-backend.js                  in-memory mirror + seeded Burlington cast
js/app.js                           UI
data/plans.json                     events-sourced plans (scripts/build-plans.mjs, nightly)
data/places.json                    Ready-to-meet places + the standing Saturday plan
data/questions.json                 222 cards from the Stay Awhile deck
supabase/small-talk-SETUP.sql       st_* tables, RLS, RPCs, storage bucket + policies
supabase/functions/st-moderate      OpenAI moderation on send + photos (optional)
supabase/functions/st-notify        email (Resend) + web push drain (optional)
scripts/test-core.mjs               node --test
scripts/sql-check.sh + sql-smoke.sql  applies SQL to a scratch local Postgres + e2e smoke
scripts/playtest.mjs                Playwright: full demo flow + no-backend fail-soft
scripts/build-plans.mjs  make-icons.mjs  vapid.mjs
PLANS-CONTRACT.md                   the Up For It ⇄ Small Talk interface
SETUP.md                            the one-time switches only Stephen can flip
```

## Verify

```
node --test scripts/test-core.mjs
for f in js/*.js sw.js; do node --check "$f"; done
./scripts/sql-check.sh                       # needs local postgresql@17 running
NODE_PATH=<dir with playwright> node scripts/playtest.mjs   # screenshots → scripts/screenshots/
node scripts/build-plans.mjs                 # refresh data/plans.json from the live feed
```

## Fail-soft, by design

No SQL yet → `not_ready`, the landing still renders, plans still load from
JSON. No `st-moderate` → plain `st_send` (unmoderated; the report queue still
works). No `st-notify` / no Resend key → everything waits in Inbox. No VAPID
key → no push, email only. `?demo=1` runs the whole thing against the fake
backend with a seeded cast and saves nothing.

## Honest threat model

The anon key is public. Supabase Auth (Google / magic link) + RLS +
SECURITY DEFINER RPCs + rate limits + reports + the back room stop casual
mischief, not a determined adversary. Nothing here is presented as
integrity-protected, and the About page says so in plain words.
