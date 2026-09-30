# Appliance Desk overhaul — start here

Prepared 2026-09-30 for Chris Robinson. This is a complete planning handoff,
not a claim that the redesign or new features have been implemented.

1. [Design and system specification](DESIGN.md): current-state audit, navigation,
   brand/UI rules, detailed screen layouts, backend contracts and release scope.
2. [Implementation cards](TASKS.md): 32 ordered tasks with dependencies, file
   entry points, model assignment, acceptance checks and release gates.
3. [Implementation prompt and model guide](IMPLEMENTER.md): paste-ready task
   prompt, review prompt, token/cost controls and verified model guidance.
4. [Owner inputs](../../OWNER-INPUTS.md): mailing address, reply/public email,
   phone, release decisions and other inputs; known facts are not asked again.
5. [Google Workspace connector](GOOGLE-WORKSPACE.md): identified repository,
   deployed MCP URL, connection steps and what remains unverified.

Recommended approach: preserve the working application and replace the most
painful interactions first. Finish foundation and daily-use releases A/B
before spending time on optional imports, advanced automation or new integrations.
The plan is tailored to an owner working long shifts, often using a phone.
It does not make Chris choose technical details a competent implementer can decide.

Primary implementation recommendation: Luna High for explicit UI cards,
GPT-6.1 Sol for database/auth/billing/integration cards and review. If using
one model only, use GPT-6.1 Sol. Evaluate cost per accepted change rather than
price per token alone. No new subscription or API spend is authorized here.

PR #86 contains a separate, already-tested prelaunch signup/email feature.
Check its current merge state before implementing anything that depends on it.
This planning branch starts from current main and contains documentation only.
