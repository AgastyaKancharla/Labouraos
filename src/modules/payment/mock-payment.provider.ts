import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  WebhookVerificationResult,
  DisbursePayoutResult,
} from './payment-provider.interface';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  async createCharge(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
  ): Promise<{ paymentLink: string; gatewayReference: string }> {
    const timestamp = Date.now();
    const randomHex = Math.random().toString(36).substring(2, 8);
    const gatewayReference = `mock_gw_${subjectType}_${timestamp}_${randomHex}`;
    const paymentLink = `https://pay.laboura.local/pay/${gatewayReference}`;

    this.logger.log(
      `[MOCK PAYMENT] Created charge of ${amountPaise} paise for ${subjectType}:${subjectId}. Reference: ${gatewayReference}`,
    );

    return {
      paymentLink,
      gatewayReference,
    };
  }

  async disbursePayout(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
    metadata?: Record<string, unknown>,
  ): Promise<DisbursePayoutResult> {
    const timestamp = Date.now();
    const randomHex = Math.random().toString(36).substring(2, 8);
    const gatewayReference = `mock_payout_gw_${subjectType}_${timestamp}_${randomHex}`;
    const shouldFail = metadata?.simulateFailure === true;

    this.logger.log(
      `[MOCK PAYOUT] Disbursing payout of ${amountPaise} paise to ${subjectType}:${subjectId}. Status: ${shouldFail ? 'failed' : 'succeeded'}. Reference: ${gatewayReference}`,
    );

    return {
      success: !shouldFail,
      gatewayReference,
      status: shouldFail ? 'failed' : 'succeeded',
      failureReason: shouldFail ? 'Simulated disbursement failure' : undefined,
    };
  }

  async verifyWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<WebhookVerificationResult> {
    if (signature === 'invalid-signature') {
      return {
        isValid: false,
        gatewayReference: '',
        status: 'failed',
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        isValid: false,
        gatewayReference: '',
        status: 'failed',
      };
    }

    const data = payload as Record<string, unknown>;
    const gatewayReference = String(data.gatewayReference || data.reference || '');
    const status = data.status === 'failed' ? 'failed' : 'succeeded';
    const amountPaise = typeof data.amountPaise === 'number' ? data.amountPaise : undefined;

    if (!gatewayReference) {
      return {
        isValid: false,
        gatewayReference: '',
        status: 'failed',
      };
    }

    return {
      isValid: true,
      gatewayReference,
      status,
      amountPaise,
      rawPayload: data,
    };
  }
}
