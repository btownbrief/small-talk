# Small Talk — setup: what's done, and the switches only Stephen can flip

Project: Supabase `jnouvwxomrcffqwilqkq` (the fleet project). Repo
`btownbrief/small-talk` → GitHub Pages → https://play.btownbrief.com/small-talk/

## Done by the build session (2026-08-23)

- [x] Repo pushed, Pages enabled (main, root).
- [x] `supabase/small-talk-SETUP.sql` installed on the live project (idempotent; re-run any time with
      `supabase db query --linked -f supabase/small-talk-SETUP.sql` from a linked checkout).
- [x] Storage bucket `st-photos` (private) + policies, created by the SQL.
- [x] Auth: site URL + redirect allow-list set to the Pages URL (+ localhost for dev) via the
      management API. Email magic links are ON (Supabase's built-in mailer — see ⚠ below).
- [x] Edge functions `st-moderate` and `st-notify` deployed **without secrets** — they fail soft
      (unmoderated sends / nothing delivered) until the keys below exist.
- [x] Nightly `refresh-plans` workflow (05:15 ET) rebuilds `data/plans.json`.

## Done by the follow-up session (2026-08-23, later)

- [x] **Custom SMTP via Resend** set on the project's Auth config (host smtp.resend.com:465, user
      `resend`, sender "Btown Brief" <hello@btownbrief.com>, 30 emails/hour). Magic links now reach
      anyone. Test email from hello@btownbrief.com delivered.
- [x] `RESEND_API_KEY` + `NOTIFY_FROM` secrets were already on the project (set by the Who's Playing /
      Up For It sessions) — hi/message emails deliver.
- [x] **Web push**: VAPID pair generated, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`
      set as secrets, public key committed in `js/net.js`. Keys also saved in
      `~/.config/btownbrief/secrets.env`.
- [x] **Independent code review (Opus) applied** — see README "After the 2026-08-23 code review".
      SQL re-installed live, both functions redeployed, all checks green (15 node tests, SQL smoke,
      Playwright 27 checks, live probes of st-notify auth).
- [x] **pg_cron** every 5 min → `st-notify` (drains notifications, moderates pending photos, sweeps
      orphan photo folders). `NOTIFY_CRON_SECRET` is a function secret + Vault secret
      `st_notify_cron_secret`; `supabase/small-talk-CRON.sql` is the job. Local copy of the secret in
      `~/.config/btownbrief/secrets.env` (`ST_NOTIFY_CRON_SECRET`).
- [x] Google Cloud project `ops-dashboard-504300`: OAuth consent-screen app name renamed from
      "Ops Dashboard" to **"Btown Brief"** (it's what members see on the Google sign-in screen;
      publishing status was already In production / External, so no test-user list).

## ⚠ Stephen's switches (in order of how much they matter)

1. ~~Google sign-in~~ — DONE 2026-08-23. OAuth client `small-talk` (Web application) in Cloud project
   `ops-dashboard-504300`; Supabase Google provider enabled via the management API; consent screen
   shows "Btown Brief". Client ID/secret also in `~/.config/btownbrief/secrets.env`.
2. ~~Email that actually sends~~ — DONE (Resend SMTP on).
3. ~~Moderation~~ — DONE 2026-08-23 (`OPENAI_API_KEY` set; key "small-talk" in Stephen's OpenAI project).
4. ~~Notification emails~~ — DONE (`RESEND_API_KEY` + `NOTIFY_FROM` secrets set).
5. ~~Web push~~ — DONE (VAPID set, public key committed). iPhone users must Add to Home Screen first
   (the app walks them through it).
6. **Moderator account:** `st_mods` has `stephenvdavis@gmail.com`. Sign in with that Google account
   (or that email's magic link) and `mod.html` unlocks. Add a second moderator:
   `insert into st_mods values ('email')`.
7. **Hub listing:** deliberately not registered on the hub / arcade yet. When you're ready, add it
   like Who's Playing was (btownbrief.github.io games.json + hub card). Suggest leaving it unlisted
   until cohort 1 (Saturday group + a newsletter ask) has tried it.

## Cohort 1 checklist (from the spec)

- All switches on (Google, SMTP, notify emails, push, OpenAI moderation) as of 2026-08-23.
- You create your own profile (this also tests photos + moderation end to end).
- Invite the Saturday crowd with the link; one newsletter line for ~100 founding members.
- Watch `mod.html` weekly: the dating-lane ratio box is the thing to look at.
