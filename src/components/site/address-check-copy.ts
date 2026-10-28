import type { AddressCheckCopy } from "./address-check";

/** The address checker's words from the website items (shared by the home and service-area pages). */
export function addressCheckCopy(c: (key: string) => string): Omit<AddressCheckCopy, "button"> {
  return {
    addressLabel: c("home.check.address.label"),
    zipLabel: c("home.check.zip.label"),
    served: c("home.check.served"),
    servedFree: c("home.check.served.free"),
    servedNoPrice: c("home.check.served.noprice"),
    servedLink: c("home.check.served.cta"),
    notYet: c("home.check.notyet"),
    notYetLink: c("home.check.notyet.cta"),
    unknown: c("home.check.unknown"),
    invalid: c("home.check.invalid"),
    limited: c("home.check.limited"),
  };
}
