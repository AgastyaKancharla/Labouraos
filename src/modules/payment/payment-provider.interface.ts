export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface WebhookVerificationResult {
  isValid: boolean;
  gatewayReference: string;
  status: 'succeeded' | 'failed';
  amountPaise?: number;
  rawPayload?: Record<string, unknown>;
}

export interface PaymentProvider {
  createCharge(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
  ): Promise<{ paymentLink: string; gatewayReference: string }>;

  verifyWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<WebhookVerificationResult>;
}
