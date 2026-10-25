import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  DisbursePayoutResult,
  PaymentProvider,
  WebhookVerificationResult,
} from './payment-provider.interface';

export interface RealPaymentProviderOptions {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  accountNumber?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

@Injectable()
export class RealPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(RealPaymentProvider.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly accountNumber: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options?: RealPaymentProviderOptions) {
    this.keyId =
      options?.keyId ??
      process.env.RAZORPAY_KEY_ID ??
      process.env.PAYMENT_GATEWAY_KEY ??
      'rzp_test_dummy_key_id';
    this.keySecret =
      options?.keySecret ??
      process.env.RAZORPAY_KEY_SECRET ??
      process.env.PAYMENT_GATEWAY_SECRET ??
      'dummy_gateway_secret';
    this.webhookSecret =
      options?.webhookSecret ??
      process.env.RAZORPAY_WEBHOOK_SECRET ??
      process.env.PAYMENT_WEBHOOK_SECRET ??
      'dummy_webhook_secret_for_hmac';
    this.accountNumber =
      options?.accountNumber ??
      process.env.RAZORPAYX_ACCOUNT_NUMBER ??
      '7878780080387492';
    this.baseUrl = (
      options?.baseUrl ??
      process.env.PAYMENT_API_URL ??
      'https://api.razorpay.com/v1'
    ).replace(/\/$/, '');
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  private getAuthHeader(): string {
    const credentials = `${this.keyId}:${this.keySecret}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  async createCharge(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
  ): Promise<{ paymentLink: string; gatewayReference: string }> {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error(`Amount must be an integer in paise, received: ${amountPaise}`);
    }

    const timestamp = Date.now();
    const randomHex = crypto.randomBytes(3).toString('hex');
    const referenceId = `ref_${subjectType}_${timestamp}_${randomHex}`;

    const payload = {
      amount: amountPaise,
      currency: 'INR',
      accept_partial: false,
      reference_id: referenceId,
      description: `Laboura ${subjectType} charge (${subjectId})`,
      notify: {
        sms: true,
        email: false,
      },
    };

    try {
      const response = await this.fetchFn(`${this.baseUrl}/payment_links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Payment gateway createCharge failed with status ${response.status}: ${errorText}`,
        );
        throw new Error(`Payment gateway failed to create charge: ${errorText}`);
      }

      const data = (await response.json()) as {
        id: string;
        short_url?: string;
        reference_id?: string;
      };

      const gatewayReference = data.id || data.reference_id || referenceId;
      const paymentLink =
        data.short_url || `https://rzp.io/i/${gatewayReference}`;

      this.logger.log(
        `Created real payment link: ${paymentLink} with gateway reference: ${gatewayReference}`,
      );

      return {
        paymentLink,
        gatewayReference,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Network error calling payment gateway: ${msg}`);
      throw new Error(`Payment gateway request failed: ${msg}`);
    }
  }

  async disbursePayout(
    amountPaise: number,
    subjectType: string,
    subjectId: string,
    metadata?: Record<string, unknown>,
  ): Promise<DisbursePayoutResult> {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new Error(`Amount must be an integer in paise, received: ${amountPaise}`);
    }

    const timestamp = Date.now();
    const referenceId = `pout_${subjectType}_${subjectId}_${timestamp}`;

    const payload = {
      account_number: this.accountNumber,
      fund_account_id:
        (metadata?.fundAccountId as string) ||
        `fa_test_${subjectType}_${subjectId}`,
      amount: amountPaise,
      currency: 'INR',
      mode: 'UPI',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id: referenceId,
      notes: {
        subjectType,
        subjectId,
      },
    };

    try {
      const response = await this.fetchFn(`${this.baseUrl}/payouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Payout API disbursement failed with status ${response.status}: ${errorText}`,
        );
        return {
          success: false,
          gatewayReference: referenceId,
          status: 'failed',
          failureReason: errorText,
        };
      }

      const data = (await response.json()) as {
        id: string;
        status: string;
        failure_reason?: string;
      };

      const isSucceeded =
        data.status === 'processed' ||
        data.status === 'processing' ||
        data.status === 'succeeded';

      return {
        success: isSucceeded,
        gatewayReference: data.id || referenceId,
        status: isSucceeded ? 'succeeded' : 'failed',
        failureReason: isSucceeded ? undefined : data.failure_reason,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Network error calling payout API: ${msg}`);
      return {
        success: false,
        gatewayReference: referenceId,
        status: 'failed',
        failureReason: msg,
      };
    }
  }

  async verifyWebhook(
    payload: unknown,
    signature?: string,
  ): Promise<WebhookVerificationResult> {
    if (!payload || typeof payload !== 'object') {
      return {
        isValid: false,
        gatewayReference: '',
        status: 'failed',
      };
    }

    if (!signature) {
      return {
        isValid: false,
        gatewayReference: '',
        status: 'failed',
      };
    }

    // HMAC-SHA256 signature verification
    const payloadStr =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadStr)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    const isValidSignature =
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValidSignature) {
      this.logger.warn('Webhook signature mismatch in RealPaymentProvider');
      return {
        isValid: false,
        gatewayReference: '',
        status: 'failed',
      };
    }

    const data = payload as Record<string, unknown>;

    // Parse real vendor webhook payload structure (e.g. Razorpay event webhook)
    let gatewayReference = '';
    let status: 'succeeded' | 'failed' = 'failed';
    let amountPaise: number | undefined;

    const payloadObj = data.payload as Record<string, unknown> | undefined;
    const paymentLinkObj = payloadObj?.payment_link as
      | { entity?: { id?: string; status?: string; amount?: number; reference_id?: string } }
      | undefined;
    const paymentObj = payloadObj?.payment as
      | { entity?: { id?: string; status?: string; amount?: number } }
      | undefined;

    if (paymentLinkObj?.entity?.id) {
      gatewayReference = paymentLinkObj.entity.id;
      amountPaise = paymentLinkObj.entity.amount;
      const plStatus = paymentLinkObj.entity.status;
      status = plStatus === 'paid' ? 'succeeded' : 'failed';
    } else if (paymentObj?.entity?.id) {
      gatewayReference = paymentObj.entity.id;
      amountPaise = paymentObj.entity.amount;
      const payStatus = paymentObj.entity.status;
      status =
        payStatus === 'captured' || payStatus === 'authorized'
          ? 'succeeded'
          : 'failed';
    } else {
      // Fallback for top-level fields
      gatewayReference = String(data.gatewayReference || data.id || data.reference || '');
      const event = String(data.event || data.status || '');
      status =
        event === 'succeeded' ||
        event === 'payment_link.paid' ||
        event === 'payment.captured' ||
        event === 'paid'
          ? 'succeeded'
          : 'failed';
      if (typeof data.amountPaise === 'number') {
        amountPaise = data.amountPaise;
      } else if (typeof data.amount === 'number') {
        amountPaise = data.amount;
      }
    }

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
