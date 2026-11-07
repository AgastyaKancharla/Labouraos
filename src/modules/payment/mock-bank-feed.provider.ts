import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  BankFeedEvent,
  BankFeedProvider,
  BankFeedVerificationResult,
} from './bank-feed-provider.interface';

@Injectable()
export class MockBankFeedProvider implements BankFeedProvider {
  private readonly logger = new Logger(MockBankFeedProvider.name);

  async verifyWebhook(
    rawBody: Buffer | string | undefined,
    signature?: string,
  ): Promise<BankFeedVerificationResult> {
    const invalid: BankFeedVerificationResult = { isValid: false };

    if (signature === 'invalid-signature') {
      return invalid;
    }

    const secret = process.env.BANK_FEED_WEBHOOK_SECRET;

    if (secret) {
      if (!signature || rawBody === undefined) {
        return invalid;
      }
      const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(raw)
        .digest('hex');

      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSignature, 'utf8');

      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return invalid;
      }
    }

    if (rawBody === undefined) {
      return invalid;
    }

    const rawStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    try {
      const data = JSON.parse(rawStr) as Record<string, unknown>;
      if (!data || typeof data !== 'object') {
        return invalid;
      }
      const bankUtr = String(data.bankUtr || data.utr || '').trim();
      const rawAmount = data.amountPaise ?? data.amount;
      const amountPaise = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount);

      if (!bankUtr || isNaN(amountPaise)) {
        return invalid;
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
      return invalid;
    }
  }
}
