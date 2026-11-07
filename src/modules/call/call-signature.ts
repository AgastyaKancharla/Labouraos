import { validateWebhookHmac, signWebhookHmac } from '../../common/webhook/webhook-signature';

export function signCallStatusBody(rawBody: Buffer | string, secret: string): string {
  return signWebhookHmac(rawBody, secret);
}

export function callStatusSignatureMatches(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  return validateWebhookHmac(rawBody, signature, secret).isValid;
}
