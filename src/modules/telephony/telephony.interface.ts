export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';

export interface InboundCallEvent {
  callId: string;
  callerPhone: string;
  virtualNumber?: string;
  timestamp?: Date;
  recordingUrl?: string;
  recordingEnabled?: boolean;
  recordingConsent?: boolean;
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

export interface OutboundCallParams {
  agentPhone: string;
  customerPhone: string;
  recordCall?: boolean;
  metadata?: Record<string, string>;
}

export interface OutboundCallResult {
  callId: string;
  status: 'initiated' | 'queued' | 'failed';
  recordingEnabled: boolean;
  consentAnnounced: boolean;
  error?: string;
}

export interface TelephonyProvider {
  handleInboundCall(event: InboundCallEvent): Promise<InboundCallResult>;
  initiateOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult>;
  getCapacity(): TelephonyCapacity;
}
