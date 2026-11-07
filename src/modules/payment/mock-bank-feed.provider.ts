import { Injectable, Logger } from '@nestjs/common';
import {
  BankFeedEvent,
  BankFeedProvider,
  BankFeedVerificationResult,
} from './bank-feed-provider.interface';
import { validateWebhookHmac } from '../../common/webhook/webhook-signature';

@Injectable()
export class MockBankFeedProvider implements BankFeedProvider {
  private readonly logger = new Logger(MockBankFeedProvider.name);

  async verifyWebhook(
    rawBody: Buffer | string | undefined,
    signature?: string,
  ): Promise<BankFeedVerificationResult> {
    const secret = process.env.BANK_FEED_WEBHOOK_SECRET;
    const validation = validateWebhookHmac(rawBody, signature, secret);
    if (!validation.isValid) {
      this.logger.warn(`Bank feed webhook validation failed: ${validation.reason}`);
      return { isValid: false, reason: validation.reason };
    }

    const rawStr = typeof rawBody === 'string' ? rawBody : rawBody!.toString('utf8');
    try {
      const data = JSON.parse(rawStr) as Record<string, unknown>;
      if (!data || typeof data !== 'object') {
        return { isValid: false, reason: 'invalid_json' };
      }
      const bankUtr = String(data.bankUtr || data.utr || '').trim();
      const rawAmount = data.amountPaise ?? data.amount;
      const amountPaise = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);

      if (!bankUtr || isNaN(amountPaise) || amountPaise <= 0) {
        return { isValid: false, reason: 'invalid_payload' };
      }

      const receivedAt = data.receivedAt ? new Date(String(data.receivedAt)) : new Date();

      const event: BankFeedEvent = {
        bankUtr,
        amountPaise,
        receivedAt,
        payerName: data.payerName ? String(data.payerName) : undefined,
        payerVpaMasked: data.payerVpaMasked ? String(data.payerVpaMasked) : undefined,
        remark: data.remark ? String(data.remark) : undefined,
      };

      return {
        isValid: true,
        event,
      };
    } catch {
      return { isValid: false, reason: 'invalid_json' };
    }
  }
}
