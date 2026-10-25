export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';

export interface InboundCallEvent {
  callId: string;
  callerPhone: string;
  virtualNumber?: string;
  timestamp?: Date;
  recordingUrl?: string;
  recordingEnabled?: boolean;
}

export interface InboundCallResult {
  callbackTaskId: string;
  isDuplicate: boolean;
  consentAnnounced: boolean;
  consentAuditLogId?: string;
}

export interface TelephonyCapacity {
  concurrentChannels: number;
  maxAgentsSupported: number;
  vendor: string;
}

export interface TelephonyProvider {
  handleInboundCall(event: InboundCallEvent): Promise<InboundCallResult>;
  getCapacity(): TelephonyCapacity;
}
