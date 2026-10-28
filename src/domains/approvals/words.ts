// AR-2: the approval outcome and status words, shared by the approvals page
// and Today's approvals Sheet so both say exactly the same thing.
export const OUTCOME_WORDS: Record<string, string> = {
  approved: "Approved and done.",
  waiting: "Approved, but not finished: Stripe has not confirmed yet. See the note under Recently decided; do not repeat it.",
  uncertain: "Approved, but we could not confirm what happened. Money may already have been sent, so do not repeat it. Use Check and finish in two minutes, or see Billing → Waiting for Stripe.",
  failed: "Approved, but it could not be done. The reason is under Recently decided. Nothing was sent.",
  declined: "Declined. Nothing was changed.",
  expired: "That request had expired, so nothing was done.",
  refused: "That could not be done (it may already be decided, or is too new to finish).",
};

export const STATUS_WORDS: Record<string, string> = { APPROVED: "Approved and done", DECLINED: "Declined", EXPIRED: "Expired", FAILED: "Approved but could not be done" };
