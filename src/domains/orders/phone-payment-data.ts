/**
 * Phone staff never collect payment credentials. Reject apparent primary card
 * numbers in free-text notes before persistence or audit. False positives are
 * limited by the Luhn checksum, so phone numbers, dates and order references
 * continue to work. Payment details belong on Stripe-hosted pages only.
 */
export function rejectPhonePaymentCredentials(...values: Array<string|null|undefined>) {
  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(/(?:\d[ -]?){13,19}/g)) {
      const digits = match[0].replace(/[^0-9]/g,"");
      if (digits.length < 13 || digits.length > 19) continue;
      let sum=0, double=false;
      for (let i=digits.length-1;i>=0;i--) {
        let n=Number(digits[i]);
        if (double) {n*=2;if(n>9)n-=9;}
        sum+=n;
        double=!double;
      }
      if(sum%10===0)
        throw new Error("Do not type card numbers in a phone order. Send the Stripe payment link instead.");
    }
    if (/\b(?:cvv|cvc|card\s*security\s*code|card\s*pin)\s*[:#-]?\s*\d{3,4}\b/i.test(value))
      throw new Error("Do not type card security codes in a phone order.");
  }
}
