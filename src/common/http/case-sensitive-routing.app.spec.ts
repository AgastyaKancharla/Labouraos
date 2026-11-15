import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { caseSensitiveHttpAdapter } from './case-sensitive-routing';

/**
 * The whole application on the same HTTP adapter main.ts uses
 * (caseSensitiveHttpAdapter): a capitalised spelling of a real API address is
 * a 404 and never reaches the route.
 */
describe('the full app routes case-sensitively (main.ts adapter)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(caseSensitiveHttpAdapter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 404 for /Job-Seekers/… and other spellings, while /job-seekers/… reaches its route (401 without a login)', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/job-seekers/JS-00001').set('Accept', 'application/json')).status).toBe(401);
    for (const url of ['/Job-Seekers/JS-00001', '/JOB-SEEKERS/JS-00001/status', '/Referrals/RF-00001', '/Vacancies/VC-00001']) {
      const res = await request(server).get(url).set('Accept', 'application/json');
      expect([url, res.status]).toEqual([url, 404]);
    }
    const post = await request(server).post('/Consent/links').set('Accept', 'application/json').send({ jobSeekerId: 'x' });
    expect(post.status).toBe(404);
  });
});
