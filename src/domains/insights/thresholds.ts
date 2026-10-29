// AR-9 (INSIGHTS section 3): display thresholds. These decide whether a
// percentage is meaningful yet — they are NOT business policy, so they stay
// in code (the PR says so). Counts and money totals always show; only
// rates, medians and averages wait for the threshold.
export const MIN_LEADS = 10;
export const MIN_RENTALS = 10;
