# ACC-3 — Sign-in codes by email or text

Design: `docs/designs/ACCOUNTS-AND-SIGN-IN.md` section 6. Base: ACC-2 (stacked). Batch ACC, third of five.
Risk: **auth** (read `docs/AI-PR-READ-FIRST.md`). Text codes are a live SMS path: agents never turn the switch on (AGENTS section 1).

## Why
Two-step sign-in works only with an authenticator app today. Chris wants a person to choose an authenticator app, a text code or an email
code, with the owner setting which are allowed for each access level.

## What the library gives us (checked in `node_modules/better-auth`, 2026-10-24)
Sign-in code mode (`otpOptions.sendOTP`, 6 digits, `period` in minutes, 5 tries, hashed storage), lockout, backup codes. The library makes and
checks the code; our `sendOTP` only delivers it, by the person's STORED choice. Turning two-step on by code needs the person to prove a code
first (we enable through the authenticator route so backup codes exist, then the first code entered turns it on).

## Acceptance
- A person chooses **Authenticator app, Text message code or Email code** when setting up (`/desk/security/setup`), limited to what the owner allows for their access level. Backup codes are always made.
- Codes are 6 digits, work 5 minutes, allow 5 tries, and asking for a code is limited to 3 a minute. They are stored scrambled and never written to the activity record.
- Where a code goes comes only from the person's saved choice (`User.secondStepMethod`), never from the browser. A person whose choice is the app gets nothing sent.
- **Text codes** go out only when ALL are true: live site, phone-provider keys present, and the owner's separate switch **Send sign-in codes by text** (off to start; own switch, not the customer-texting one). Otherwise nothing is sent (recorded as not attempted) and the screen points to the authenticator app or a backup code. A phone must be checked with a text code before it can be used.
- **Owner rules** (Settings → Security, owner only): which methods each level may use. Starting value: owner and admins authenticator or text; staff all three (email codes for owner/admins stay off, IN-85). The authenticator app can never be removed. Changing the rules never signs anyone out; people on a method that is no longer allowed keep it and are told to switch on My account.
- **My account → Second step**: shows the method, checks the phone, and switches between text and email by proving a code from the new method.
- The login screen has a **Text or email code** tab with "Send me a code"; the answer is the same whichever method the account uses.
- Switches page lists "Sign-in codes by text". Every rule or method change is recorded (`security.second_step_policy`, `security.second_step_choice`, `security.second_step_switch`, `security.phone_confirmed`, `security.sign_in_code` with only the method and result).
- Additive migration `20261024060000_second_step_methods` (`User.secondStepMethod`, `BusinessSettings.secondStepMethodsByLevel`, `securitySmsEnabled`); existing two-step users are marked authenticator.

## Tests
- `tests/acc3-second-step-rules.test.ts` (no database): starting policy, fallbacks, authenticator always kept, text availability, code format.
- `tests/acc3-second-step-integration.test.ts` (throwaway Postgres, email and text mocked): only the owner changes rules, forbidden methods and switched-off text cannot be chosen, delivery follows the stored choice and never leaves a code in the record, Twilio is never called while the switch is off, wrong tries counted, expired / reused / over-tried codes refused, resend waits a minute, rule changes never change anyone's method.
- `e2e/two-factor.spec.ts` (shard b): the setup choice step, and the login "Text or email code" tab answers without blocking the authenticator.

## Not in this card
- **Trusted device for 30 days** (the library supports it, but it skips the second step and the owner setting needs more design); left for a later card.
- Switching back to the authenticator app after choosing text or email (until then: backup codes, or the owner's reset in ACC-4).
- Real text delivery: needs Twilio live and the owner's switch (checklist row in OWNER-CHECKLIST.md). Real-inbox delivery of email codes is a production-only observation.
