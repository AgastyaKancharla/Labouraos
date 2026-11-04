import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Reads CALL_ROUTING_KEY. Throws if it is missing or shorter than 32 characters,
 * so a process that constructs the staff service cannot start without it.
 */
export function getCallRoutingKey(): Buffer {
  const secret = process.env.CALL_ROUTING_KEY?.trim();
  if (!secret) {
    throw new Error(
      'CALL_ROUTING_KEY environment variable is missing or empty. Server cannot start without a secure secret.',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `CALL_ROUTING_KEY must be at least 32 characters long (received ${secret.length} characters).`,
    );
  }
  return createHash('sha256').update(secret).digest();
}

/** AES-256-GCM. The stored text is not the phone number. */
export function encryptCallRoutingPhone(phone: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getCallRoutingKey(), iv);
  const encrypted = Buffer.concat([cipher.update(phone, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptCallRoutingPhone(stored: string): string {
  const [ivPart, tagPart, dataPart] = stored.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Stored call routing phone is not encrypted');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getCallRoutingKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
