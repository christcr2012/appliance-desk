// ACC-4: pure rules for the wrong-password pause. No database here.

export const PAUSE_ATTEMPTS_DEFAULT = 10;
export const PAUSE_MINUTES_DEFAULT = 15;
export const PAUSE_ATTEMPTS_MIN = 3;
export const PAUSE_ATTEMPTS_MAX = 50;
export const PAUSE_MINUTES_MIN = 1;
export const PAUSE_MINUTES_MAX = 240;

export type FailureState = { count: number; windowStartedAt: Date | null; pausedUntil: Date | null };

/**
 * One more wrong password. The count restarts when the window (the same number of minutes as the wait) has run out;
 * reaching the allowed number pauses the account and starts a fresh count for afterwards.
 */
export function nextFailureState(prev: { count: number; windowStartedAt: Date | null }, now: Date, attempts: number, minutes: number): FailureState & { justPaused: boolean } {
  const windowMs = minutes * 60_000;
  const fresh = !prev.windowStartedAt || now.getTime() - prev.windowStartedAt.getTime() >= windowMs;
  const count = (fresh ? 0 : prev.count) + 1;
  const windowStartedAt = fresh ? now : prev.windowStartedAt;
  if (count >= attempts) return { count: 0, windowStartedAt: null, pausedUntil: new Date(now.getTime() + windowMs), justPaused: true };
  return { count, windowStartedAt, pausedUntil: null, justPaused: false };
}

export function pauseMessage(until: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return `Too many wrong passwords. Sign-in for this account is paused for about ${minutes} minute${minutes === 1 ? "" : "s"}. You can also use "Forgot password".`;
}

export function validatePauseSettings(attempts: unknown, minutes: unknown): { attempts: number; minutes: number } {
  const a = Number(attempts);
  const m = Number(minutes);
  if (!Number.isInteger(a) || a < PAUSE_ATTEMPTS_MIN || a > PAUSE_ATTEMPTS_MAX) throw new Error(`Allowed wrong passwords must be a whole number from ${PAUSE_ATTEMPTS_MIN} to ${PAUSE_ATTEMPTS_MAX}.`);
  if (!Number.isInteger(m) || m < PAUSE_MINUTES_MIN || m > PAUSE_MINUTES_MAX) throw new Error(`The wait must be a whole number of minutes from ${PAUSE_MINUTES_MIN} to ${PAUSE_MINUTES_MAX}.`);
  return { attempts: a, minutes: m };
}
