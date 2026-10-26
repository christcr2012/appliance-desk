// OPS-1: the plain-English notes written when a recall is confirmed. Pure text; nothing here sends anything.

/** Plain, short note for the To do list. The full drafted message is on the recall page. */
export function renterTaskNote(input: { customerName: string; assetNumber: string; title: string }): string {
  return `Contact ${input.customerName}: swap or repair ${input.assetNumber} (recall: ${input.title})`.slice(0, 500);
}

/** The message Chris can copy to a renter. Written in the business's own name; never sent by the app. */
export function draftRenterMessage(input: { customerName: string; applianceLabel: string; title: string; remedy: string | null; url: string }): string {
  const fix = input.remedy ? `The maker's fix is: ${input.remedy}.` : "The maker has not posted a fix yet.";
  return [
    `Hi ${input.customerName},`,
    "",
    `This is Robinson Appliance Rentals. The U.S. Consumer Product Safety Commission has announced a recall that may cover the ${input.applianceLabel} you are renting from us ("${input.title}").`,
    "",
    "Please stop using it until we have checked it. We would like to swap it for another machine or have it repaired at no cost to you. " + fix,
    "",
    `Details from the government notice: ${input.url}`,
    "",
    "Please reply or call us so we can set up a swap or repair. Thank you,",
    "Robinson Appliance Rentals",
  ].join("\n");
}

