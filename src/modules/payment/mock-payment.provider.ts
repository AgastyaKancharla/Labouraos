import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PayoutWebhookResult,
  WebhookVerificationResult,
  DisbursePayoutResult,
} from './payment-provider.interface';
import { parsePayoutWebhookBody } from './payout-webhook-parser';
import { validateWebhookHmac } from '../../common/webhook/webhook-signature';

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
    const inFlight = metadata?.simulateProcessing === true;
    const unknown = metadata?.simulateAmbiguous === true;

    const status: DisbursePayoutResult['status'] = shouldFail
      ? 'failed'
      : inFlight || unknown
        ? 'processing'
        : 'succeeded';

    this.logger.log(
      `[MOCK PAYOUT] Disbursing payout of ${amountPaise} paise to ${subjectType}:${subjectId}. Status: ${status}. Reference: ${gatewayReference}`,
    );

    return {
      success: !shouldFail,
      gatewayReference: unknown ? '' : gatewayReference,
      status,
      failureReason: shouldFail ? 'Simulated disbursement failure' : undefined,
      ambiguous: unknown ? true : undefined,
    };
  }

  async verifyPayoutWebhook(
    rawBody: Buffer | string,
    signature?: string,
  ): Promise<PayoutWebhookResult> {
    const secret =
      process.env.PAYOUT_WEBHOOK_SECRET || process.env.RAZORPAYX_WEBHOOK_SECRET;
    const validation = validateWebhookHmac(rawBody, signature, secret);
    if (!validation.isValid) {
      return {
        isValid: false,
        reason: validation.reason,
        event: '',
        payoutId: '',
        referenceId: null,
        paymentIdHint: null,
        gatewayStatus: '',
        outcome: 'unknown',
      };
    }

    const parsed = parsePayoutWebhookBody(rawBody.toString('utf8'));
    if (!parsed) {
      return {
        isValid: false,
        reason: 'invalid_json',
        event: '',
        payoutId: '',
        referenceId: null,
        paymentIdHint: null,
        gatewayStatus: '',
        outcome: 'unknown',
      };
    }
    return { isValid: true, ...parsed };
  }

  async verifyWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: Buffer | string,
  ): Promise<WebhookVerificationResult> {
    const secret =
      process.env.PAYMENT_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;
    const bodyToVerify = rawBody ?? (typeof payload === 'string' ? payload : undefined);
    const validation = validateWebhookHmac(bodyToVerify, signature, secret);
    if (!validation.isValid) {
      return {
        isValid: false,
        reason: validation.reason,
        gatewayReference: '',
        status: 'failed',
      };
    }

    let data: Record<string, unknown>;
    if (payload && typeof payload === 'object') {
      data = payload as Record<string, unknown>;
    } else {
      try {
        const rawStr = Buffer.isBuffer(bodyToVerify) ? bodyToVerify.toString('utf8') : String(bodyToVerify);
        data = JSON.parse(rawStr) as Record<string, unknown>;
      } catch {
        return {
          isValid: false,
          reason: 'invalid_json',
          gatewayReference: '',
          status: 'failed',
        };
      }
    }

    const gatewayReference = String(data.gatewayReference || data.reference || '');
    const status = data.status === 'failed' ? 'failed' : 'succeeded';
    const amountPaise = typeof data.amountPaise === 'number' ? data.amountPaise : undefined;

    if (!gatewayReference) {
      return {
        isValid: false,
        reason: 'missing_reference',
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
