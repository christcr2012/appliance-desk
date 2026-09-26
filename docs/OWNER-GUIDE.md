# Owner's guide (for Chris — plain English, no code)

This page will grow with each phase. Right now, in Phase 1, there isn't
a real business tool to use yet — this phase was the plumbing (the
website's foundation, the database, your login, and the safety checks
that run automatically). Nothing here is ready to run your business day
to day yet.

## What you can do right now

- **Log in** at the site's `/login` page, once your OWNER account has
  been created (see "Getting your login" below).
- That's it for Phase 1 — the actual desk (leads, customers, inventory,
  pricing, etc.) is built in the next phases.

## Getting your login

Your account isn't created automatically — it needs to be set up once,
by whoever's running the AI session that has full internet access (this
couldn't be finished from the sandbox this phase was built in — see
`docs/HANDOFF.md`). Once that's done, you'll be told your login email
so you can set your own password via the "forgot password" link, or
you'll be given a temporary password to change immediately.

## How to change prices, add an appliance, convert a lead, schedule a
## job, or handle a maintenance request

Not built yet — these arrive in Phases 2–5. This section will be filled
in with real, screenshot-free walkthroughs as each one ships, written so
you never need to touch code.

## What to do if something breaks

1. Check `docs/HANDOFF.md` — it always says what currently works and
   what's known to be broken.
2. If the site is down or showing errors for customers, that should
   show up automatically in Sentry (once it's turned on — see
   `docs/HANDOFF.md`) and you'd be alerted.
3. Otherwise, tell whichever AI is helping you exactly what you clicked
   and what happened — "it broke" is harder to fix than "I clicked
   Save on the pricing page and got a red error message."
