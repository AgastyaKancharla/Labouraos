import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

/** The smallest JPEG the live-camera check accepts (by its first bytes). */
export const SETUP_SELFIE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 2, 3, 0xff, 0xd9]);

let ipCounter = 0;

/**
 * First-login set-up needs the live selfie before the password whenever no
 * photo is on file (Fable review L5). Takes it with the set-up ticket when
 * the `setup_required` answer says one is needed; does nothing otherwise.
 */
export async function takeSetupSelfie(
  app: INestApplication,
  start: { photoRequired?: boolean; setupTicket?: string },
  deviceId: string,
): Promise<void> {
  if (!start.photoRequired) return;
  ipCounter += 1;
  await request(app.getHttpServer())
    .post('/auth/setup/photo')
    .set('X-Forwarded-For', `10.199.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`)
    .set('x-setup-ticket', String(start.setupTicket ?? ''))
    .set('x-device-id', deviceId)
    .field('captureSource', 'live_camera')
    .attach('photo', SETUP_SELFIE_JPEG, 'selfie.jpg')
    .expect(200);
}
