/** Narrow SMS provider interface; voice and cost APIs have separate work units. */
export type SmsSubmitOutcome =
  | { kind: 'ACCEPTED'; resourceId: string }
  | { kind: 'REJECTED'; code: string }
  | { kind: 'NOT_ATTEMPTED'; reason: string }
  | { kind: 'UNKNOWN'; resourceId?: string };

export type SmsProviderInput = { operationId: string; from: string; to: string; text: string; callbackUrl: string };
export interface TelecomSmsProvider {
  sendSms(input: SmsProviderInput): Promise<SmsSubmitOutcome>;
  /** Free Basic Lookup only (no paid Fields). Null is not verified US. */
  verifyUsDestination?(address: string): Promise<boolean>;
}
