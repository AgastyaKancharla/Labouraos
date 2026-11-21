import { Injectable } from '@nestjs/common';

/**
 * The seam for a future bank API (HDFC or ICICI, in talks — Master Guide rev
 * 204, "Registration and payment fixes, decided 21 Nov"). There is no payment
 * gateway: money comes in by direct UPI to the company account, and until a
 * bank API is connected Finance matches each credit by hand, as today.
 *
 * When a bank API is connected, only this binding changes (our screens stay
 * the same):
 *   (a) automatic confirmation — the bank reports each credit to Laboura.
 *       The credit still comes in through the existing bank-credit path
 *       (BankFeedProvider / Finance's bank credits), so the anti-fake rule is
 *       unchanged: only a bank credit confirms a payment, never a screenshot
 *       or a UPI reference typed by the payer. `confirmsAutomatically` tells
 *       the payment page to say so;
 *   (b) optionally, card and netbanking — `extraMethods` returns the options
 *       the bank offers for one request (an empty list without a bank API, so
 *       the page shows only the UPI QR and the UPI app buttons).
 *
 * Nothing here talks to a bank yet (no bank integration in this round).
 */
export const BANK_COLLECTION_PROVIDER = 'BANK_COLLECTION_PROVIDER';

export interface BankCollectionRequest {
  paymentId: string;
  paymentCode: string;
  amountPaise: number;
  /** The UPI `tr=` reference the QR and the app buttons carry. */
  upiReference: string;
}

export interface ExtraPaymentMethod {
  kind: 'card' | 'netbanking';
  label: string;
  /** Where the bank's own page for this request starts (https only). */
  startUrl: string;
}

export interface BankCollectionProvider {
  /** Which bank API is bound ('none' today). */
  readonly name: string;
  /** (a) The bank tells Laboura automatically when the money arrives. */
  readonly confirmsAutomatically: boolean;
  /** (b) Card / netbanking options the bank offers for this request; [] without a bank API. */
  extraMethods(request: BankCollectionRequest): Promise<ExtraPaymentMethod[]>;
}

/** Today: no bank API. Direct UPI only; Finance matches credits by hand. */
@Injectable()
export class NoBankApiProvider implements BankCollectionProvider {
  readonly name = 'none';
  readonly confirmsAutomatically = false;

  async extraMethods(): Promise<ExtraPaymentMethod[]> {
    return [];
  }
}

/** Only https start pages a bank provider returns are shown (never another scheme). */
export function safeExtraMethods(methods: ExtraPaymentMethod[]): ExtraPaymentMethod[] {
  return methods.filter((m) => {
    if (m.kind !== 'card' && m.kind !== 'netbanking') return false;
    try {
      return new URL(m.startUrl).protocol === 'https:';
    } catch {
      return false;
    }
  });
}
