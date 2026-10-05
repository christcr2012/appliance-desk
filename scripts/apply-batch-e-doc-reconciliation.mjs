import fs from "node:fs";

function replaceRequired(text, pattern, replacement, label) {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`Missing expected ${label}`);
  return next;
}

{
  const path = "docs/designs/BATCH-E.md";
  let text = fs.readFileSync(path, "utf8");
  if (!text.includes("BATCH-E-DRIFT-2026-10-05.md")) {
    text = replaceRequired(
      text,
      "# Design — Batch E: Communications, automation history, search, growth signals, brand tokens & accessibility\n",
      "# Design — Batch E: Communications, automation history, search, growth signals, brand tokens & accessibility\n\n> **Final post-D implementation amendment:** before each E slice, also read `docs/designs/BATCH-E-DRIFT-2026-10-05.md` and `docs/designs/POST-BATCH-D-RECONCILIATION-2026-10-05.md`. They were verified against the merged Batch D baseline `a6c9c9acd2f1d673b6020e1819f60c34d9d9c576` and override pre-D inventory assumptions.\n",
      "Batch E title",
    );
  }
  fs.writeFileSync(path, text);
}

{
  const path = "docs/designs/POST-BATCH-D-RECONCILIATION-2026-10-05.md";
  let text = fs.readFileSync(path, "utf8");
  text = text.replace(
    /\*\*Review baseline:\*\*[^\n]*/, 
    "**Review baseline:** final Batch D merge on `main` at `a6c9c9acd2f1d673b6020e1819f60c34d9d9c576` (PR #214). The pre-merge branch references below are historical only; later batches drift-check from this merge SHA."
  );
  text = text.replace(
    "1. Finish D10–D12 verification/disposition and merge the final D branch cleanly onto current `main`; full CI green, Vercel READY, reviews resolved.\n2. Update the final D merge SHA in the E drift-check note.\n",
    "1. **DONE 2026-10-05:** D10–D12 verified and PR #214 merged; exact-head CI green, Vercel READY, zero unresolved review threads.\n2. **DONE 2026-10-05:** E drift baseline updated to final D merge `a6c9c9acd2f1d673b6020e1819f60c34d9d9c576` in `BATCH-E-DRIFT-2026-10-05.md`.\n"
  );
  fs.writeFileSync(path, text);
}

{
  const path = "docs/STATUS.md";
  let text = fs.readFileSync(path, "utf8");
  text = text.replace(
    /^Last updated:.*$/m,
    "Last updated: 2026-10-05 · `main` a6c9c9a includes completed Batch D PR #214. **In progress: Batch E PR 1 (E1–E3 automation foundation)** on `ai/sol/batch-e-automation`; then E4–E11 → E2 → F."
  );
  text = text.replace(
    /^\| D — Owner\/customer control plane, website, evidence & privacy .*$/m,
    "| D — Owner/customer control plane, website, evidence & privacy | **MERGED** | #214, merge `a6c9c9a` (2026-10-05) | Exact-head CI green; Vercel preview READY; zero unresolved review threads | Final D implementation contracts and the mandatory E/E2/F reconciliation live in `docs/designs/POST-BATCH-D-RECONCILIATION-2026-10-05.md`. |"
  );
  text = text.replace(
    /^\| E — Communications, reporting, growth, branding & accessibility .*$/m,
    "| E — Communications, reporting, growth, branding & accessibility | **IN PROGRESS** | `ai/sol/batch-e-automation` (E1–E3 first slice) | Post-D drift check: `docs/designs/BATCH-E-DRIFT-2026-10-05.md` | Implementation uses the merged D contracts. Public rate limiting is already Postgres-backed and is not being rebuilt. Live customer email/SMS/marketing stay OFF. |"
  );
  text = text.replace("- CI: ~4.5 min per full run, 3 browser shards (`e2e/shards.json`). Budget ≤ 5 min.", "- CI: parallel full run with 4 browser groups (`browser-a`…`browser-d` in `e2e/shards.json`). Budget ≤ 5 min.");
  fs.writeFileSync(path, text);
}

{
  const path = "docs/DATABASE.md";
  let text = fs.readFileSync(path, "utf8");
  if (!text.includes("## Batch E durable automation and messaging evidence")) {
    text += `\n\n## Batch E durable automation and messaging evidence\n\nMigration \`20261008010000_batch_e_messaging\` adds four additive evidence tables. \`AutomationRun\` records one named automation pass per Colorado business-day slot (including stale/unknown recovery and owner pauses). \`MessageDelivery\` is the future E sender ledger: idempotency key, channel/purpose/template/recipient/subject, explicit provider outcome, provider id and timestamps. \`ProviderEvent\` deduplicates verified Resend/Twilio webhook events. \`MarketingSuppression\` stores one normalized address/channel suppression and its source. All four are included in \`BACKUP_MODEL_POLICY\`; generated schema health automatically queries every Prisma model.\n\nThe same migration adds launch-confirmation timestamps/token hash fields, \`Lead.lastRealContactAt\`, and the lead-scoring evidence contract: \`Lead.scoringPolicyVersion\` freezes which policy produced a saved score while \`BusinessSettings.leadScoringPolicy\` starts at version 1 with the exact pre-E weights. Saving a future policy must not silently rescore historical leads. \`BusinessSettings.pausedAutomations\` is the owner-controlled list used by the automation runner; pause/resume changes are audited and never delete run history.\n`;
  }
  fs.writeFileSync(path, text);
}
