import * as request from 'supertest';
import { encode as encodeJpeg } from 'jpeg-js';

/**
 * Another ID by a live photo of the card, as the registration pages send it:
 * a real JPEG the size the capture canvas makes (no camera or editor metadata),
 * and the one-time token the page gets when the camera opens.
 */
export const LIVE_CARD_JPEG: Buffer = (() => {
  const width = 640;
  const height = 400;
  const data = Buffer.alloc(width * height * 4, 0x90);
  return Buffer.from(encodeJpeg({ data, width, height }, 80).data);
})();

/** POST <other-id path>/capture-nonce on a public link (with the verified OTP request), and its token. */
export async function captureNonceFor(server: Parameters<typeof request>[0], otherIdPath: string, requestId: string): Promise<string> {
  const res = await request(server).post(`${otherIdPath}/capture-nonce`).send({ requestId });
  const nonce = (res.body as { captureNonce?: string } | undefined)?.captureNonce;
  if (!nonce) throw new Error(`No capture token for ${otherIdPath}: ${res.status} ${JSON.stringify(res.body)}`);
  return nonce;
}
