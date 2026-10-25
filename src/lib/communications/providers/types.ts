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

/** Click-to-call (COM-N2): the provider rings the staff member's own verified phone first. */
export type VoiceCallInput = {
  operationId: string; from: string; to: string;
  /** Where the provider asks what to do once the staff member answers (signed callback). */
  url: string;
  /** Where the provider reports the call's progress. */
  statusCallback: string;
};
export type VoiceCallOutcome =
  | { kind: 'ACCEPTED'; resourceId: string }
  | { kind: 'REJECTED'; code: string }
  | { kind: 'NOT_ATTEMPTED'; reason: string }
  | { kind: 'UNKNOWN' };
export interface TelecomVoiceProvider {
  createCall(input: VoiceCallInput): Promise<VoiceCallOutcome>;
}
