/**
 * The plain message to show for a refused decision action. The decisions domain throws plain-words errors
 * ("This changed since you opened it…"); anything else (a database or provider error) gets the fallback, so no
 * technical detail ever reaches the screen.
 */
export function decisionErrorMessage(error: unknown, fallback = "That couldn't be saved. Try again."): string {
  if (!(error instanceof Error)) return fallback;
  const technical = error.constructor.name.startsWith("Prisma") || /prisma|sql|ECONN|timeout|\n/i.test(error.message);
  if (technical || error.message.length === 0 || error.message.length > 300) return fallback;
  return error.message;
}
