export const LAUNCH_STEPS = [
  {
    subject: "You're on the Robinson Appliance Rentals interest list",
    body: "Thanks for following our launch. We're a small family business preparing to bring washer and dryer rentals to Greeley and the surrounding area.\n\nMaintenance is always included. Delivery and installation will be available, with requirements and any fees confirmed for your situation.\n\nJoining this list doesn't reserve an appliance or create a rental agreement. Our opening date is still being finalized. We'll share updates as we get ready.",
    delayAfterPreviousDays: 0,
  },
  {
    subject: "Why we're starting Robinson Appliance Rentals",
    body: "We started Robinson Appliance Rentals because we believe our area needs more ways to get essential appliances into a home. Buying outright isn't the right fit for everyone, and expensive rent-to-own arrangements can be a difficult alternative.\n\nWe're building a local, family-owned rental option with maintenance included. We're still preparing to launch in Greeley and the surrounding area.\n\nWhat would make appliance rental useful for your household or property? Reply and tell us — your message goes to our business inbox.",
    delayAfterPreviousDays: 3,
  },
  {
    subject: "A few details that help us plan your appliance rental",
    body: "As we prepare to launch, it helps to know what local households and property managers need.\n\nWhen you're ready, reply with your city, whether you need a washer, dryer, or both, and your preferred timing. If you manage several properties, let us know how many units you're considering.\n\nDelivery and installation requirements vary with the location and setup. We will confirm suitability and any fees before you commit. Maintenance is always included.\n\nWe're still preparing to open, so this is an interest check rather than a reservation or promise of availability.",
    delayAfterPreviousDays: 4,
  },
] as const;

export function launchMessage(step: number, name: string) {
  const message = LAUNCH_STEPS[step];
  if (!message) throw new Error("Unknown launch email step");
  return {
    subject: message.subject,
    text: `Hi ${name},\n\n${message.body}\n\nThe Robinson Appliance Rentals family`,
  };
}
