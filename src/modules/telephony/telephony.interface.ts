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
  /** The agent whose screen the call popped up on (none when nobody is Available). */
  routedToStaffId?: string | null;
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
  /** Dial the agent's routing number before the subject. */
  ringAgentFirst?: boolean;
  announcement?: string;
  metadata?: Record<string, string>;
}

export interface OutboundCallResult {
  callId: string;
  status: 'initiated' | 'queued' | 'failed';
  recordingEnabled: boolean;
  consentAnnounced: boolean;
  error?: string;
}

/** A phone interview: Laboura rings both sides and joins them; both see only Laboura's number. */
export interface ThreeWayCallParams {
  firstPhone: string;
  secondPhone: string;
  recordCall: boolean;
  announcement?: string;
  metadata?: Record<string, string>;
}

export interface TelephonyProvider {
  handleInboundCall(event: InboundCallEvent): Promise<InboundCallResult>;
  initiateOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult>;
  getCapacity(): TelephonyCapacity;
  /**
   * Whether the calling company supports 3-way calls (guide: the phone
   * interview "needs the calling company to support 3-way calls").
   */
  supportsThreeWayCalls?(): boolean;
  initiateThreeWayCall?(params: ThreeWayCallParams): Promise<OutboundCallResult>;
}
