import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  DisbursePayoutResult,
  PaymentProvider,
  PayoutWebhookResult,
  WebhookVerificationResult,
} from './payment-provider.interface';
import {
  MAX_PAYOUT_ATTEMPTS,
  mapGatewayPayoutStatus,
  payoutIdempotencyKey,
} from './payout-state';
import { parsePayoutWebhookBody } from './payout-webhook-parser';

export interface RealPaymentProviderOptions {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  /** RazorpayX webhooks have their own secret; falls back to `webhookSecret`. */
  payoutWebhookSecret?: string;
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
  private readonly payoutWebhookSecret: string;
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
    this.payoutWebhookSecret =
      options?.payoutWebhookSecret ??
      process.env.RAZORPAYX_WEBHOOK_SECRET ??
      this.webhookSecret;
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

    // The key is derived from the payment's own id (plus the attempt number for
    // a deliberate retry) and nothing else, so repeating an attempt reuses it and
    // the gateway can dedupe (AGENTS.md §2 rule 7). No clock or random input here,
    // ever. Keys are at most 36 chars, the gateway's limit for X-Payout-Idempotency.
    const paymentId = metadata?.paymentId;
    if (typeof paymentId !== 'string' || paymentId.length === 0) {
      throw new Error(
        'disbursePayout requires metadata.paymentId to derive an idempotent reference',
      );
    }
    const attempt = typeof metadata?.attempt === 'number' ? metadata.attempt : 1;
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_PAYOUT_ATTEMPTS) {
      throw new Error(`Payout attempt must be between 1 and ${MAX_PAYOUT_ATTEMPTS}`);
    }
    const referenceId = payoutIdempotencyKey(paymentId, attempt);

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
      // Echoed back on every webhook; the way to find the payment if we never
      // received the payout id (timeout after the gateway accepted it).
      notes: {
        subjectType,
        subjectId,
        paymentId,
      },
    };

    try {
      const response = await this.fetchFn(`${this.baseUrl}/payouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
          // RazorpayX returns the existing payout's latest state when it sees
          // this key again, instead of creating a second payout
          'X-Payout-Idempotency': referenceId,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Payout API disbursement failed with status ${response.status}: ${errorText}`,
        );
        if (response.status >= 500) {
          // Server-side error: the gateway may or may not have created the payout.
          return {
            success: true,
            gatewayReference: '',
            status: 'processing',
            ambiguous: true,
            failureReason: `Gateway error ${response.status}: ${errorText}`,
          };
        }
        // 4xx: the request was refused, so no payout exists.
        return {
          success: false,
          gatewayReference: '',
          status: 'failed',
          failureReason: errorText,
        };
      }

      const data = (await response.json()) as {
        id?: string;
        status?: string;
        failure_reason?: string;
      };

      const outcome = mapGatewayPayoutStatus(data.status ?? '');
      if (outcome === 'failed' || outcome === 'reversed') {
        return {
          success: false,
          gatewayReference: data.id ?? '',
          status: 'failed',
          failureReason: data.failure_reason ?? `Gateway status: ${data.status}`,
        };
      }
      // Only `processed` is final success. Anything else (queued, processing,
      // an unrecognised status) is not yet known to have paid out.
      return {
        success: true,
        gatewayReference: data.id ?? '',
        status: outcome === 'succeeded' ? 'succeeded' : 'processing',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Network error calling payout API: ${msg}`);
      // Timeout or dropped connection: the gateway may have accepted the payout.
      // Recording this as "failed" would invite a second payment.
      return {
        success: true,
        gatewayReference: '',
        status: 'processing',
        ambiguous: true,
        failureReason: msg,
      };
    }
  }

  async verifyPayoutWebhook(
    rawBody: Buffer | string,
    signature?: string,
  ): Promise<PayoutWebhookResult> {
    const invalid: PayoutWebhookResult = {
      isValid: false,
      event: '',
      payoutId: '',
      referenceId: null,
      paymentIdHint: null,
      gatewayStatus: '',
      outcome: 'unknown',
    };

    if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) || !signature) {
      return invalid;
    }

    // HMAC-SHA256 of the RAW body, as the gateway signs it
    const expected = crypto
      .createHmac('sha256', this.payoutWebhookSecret)
      .update(rawBody)
      .digest('hex');
    const got = Buffer.from(signature, 'utf8');
    const want = Buffer.from(expected, 'utf8');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) {
      this.logger.warn('Payout webhook signature mismatch in RealPaymentProvider');
      return invalid;
    }

    const parsed = parsePayoutWebhookBody(rawBody.toString('utf8'));
    return parsed ? { isValid: true, ...parsed } : invalid;
  }

  /**
   * `rawBody` must be the exact bytes the gateway sent. The HMAC is computed over
   * those bytes, never over a parsed-then-re-serialised copy: JSON does not
   * round-trip byte-for-byte (key order, whitespace, escaped slashes and
   * unicode, number formatting), so a re-serialised body can fail to verify for
   * a genuine event, or, worse, verify something other than what was sent.
   * The body that is then acted on is parsed from those same bytes.
   */
  async verifyWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: Buffer | string,
  ): Promise<WebhookVerificationResult> {
    const invalid: WebhookVerificationResult = {
      isValid: false,
      gatewayReference: '',
      status: 'failed',
    };

    if (!signature) {
      return invalid;
    }

    // A string payload IS raw bytes; an already-parsed object is not.
    const raw = rawBody ?? (typeof payload === 'string' ? payload : undefined);
    if (raw === undefined) {
      this.logger.warn(
        'Webhook rejected: no raw request body to verify the signature against',
      );
      return invalid;
    }

    // HMAC-SHA256 signature verification over the raw bytes
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(raw)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    const isValidSignature =
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValidSignature) {
      this.logger.warn('Webhook signature mismatch in RealPaymentProvider');
      return invalid;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
    } catch {
      return invalid;
    }
    if (!parsedBody || typeof parsedBody !== 'object') {
      return invalid;
    }
    const data = parsedBody as Record<string, unknown>;

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
