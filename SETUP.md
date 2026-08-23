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

## ⚠ Stephen's switches (in order of how much they matter)

1. **Google sign-in** (the main door). In Google Cloud Console → APIs & Services → Credentials →
   *Create OAuth client ID* (Web application). Authorized redirect URI:
   `https://jnouvwxomrcffqwilqkq.supabase.co/auth/v1/callback`. Then Supabase dashboard →
   Authentication → Providers → Google: paste Client ID + Secret, enable. (~10 min.) Until then
   "Continue with Google" fails with a clear message and "Email me a link" is the door.
2. **Email that actually sends.** Supabase's built-in mailer is limited to ~2 emails/hour and only
   to addresses on your Supabase team — fine for you testing, useless for members. Supabase →
   Authentication → SMTP settings → enable custom SMTP with **Resend**: host `smtp.resend.com`,
   port 465, user `resend`, password = your Resend API key, sender `hello@btownbrief.com` (Resend
   must have btownbrief.com verified — same key Who's Playing is waiting on). This unlocks magic
   links for everyone.
3. **Moderation:** `supabase secrets set OPENAI_API_KEY=sk-... --project-ref jnouvwxomrcffqwilqkq`
   (the free moderation endpoint; no model spend). Until set, messages land unmoderated; the report
   queue still works.
4. **Notification emails:** `supabase secrets set RESEND_API_KEY=re_... NOTIFY_FROM="Small Talk <hello@btownbrief.com>" --project-ref jnouvwxomrcffqwilqkq`.
   Until set, everything waits in Inbox (the app says so).
5. **Web push** (optional, after 4): `node scripts/vapid.mjs` → paste the public key into
   `js/net.js` (`VAPID_PUBLIC_KEY`) and commit; set both keys + `VAPID_SUBJECT=mailto:hello@btownbrief.com`
   as secrets. iPhone users must Add to Home Screen first (the app walks them through it).
6. **Moderator account:** `st_mods` has `stephenvdavis@gmail.com`. Sign in with that Google account
   (or that email's magic link) and `mod.html` unlocks. Add a second moderator:
   `insert into st_mods values ('email')`.
7. **Hub listing:** deliberately not registered on the hub / arcade yet. When you're ready, add it
   like Who's Playing was (btownbrief.github.io games.json + hub card). Suggest leaving it unlisted
   until cohort 1 (Saturday group + a newsletter ask) has tried it.

## Cohort 1 checklist (from the spec)

- Google OAuth on, Resend SMTP on, OPENAI key set.
- You create your own profile (this also tests photos + moderation end to end).
- Invite the Saturday crowd with the link; one newsletter line for ~100 founding members.
- Watch `mod.html` weekly: the dating-lane ratio box is the thing to look at.
