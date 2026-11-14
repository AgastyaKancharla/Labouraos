import { Controller, Get, INestApplication, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { caseSensitiveHttpAdapter } from './case-sensitive-routing';

@Controller('job-seekers')
class ProbeController {
  @Get(':id')
  one(@Param('id') id: string) {
    return { id };
  }
}

/** main.ts serves the API with case-sensitive routing: /Job-Seekers/… is a 404. */
describe('case-sensitive routing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication(caseSensitiveHttpAdapter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the lowercase address', async () => {
    const res = await request(app.getHttpServer()).get('/job-seekers/JS-00001');
    expect(res.status).toBe(200);
    // Ids keep their own case.
    expect(res.body.id).toBe('JS-00001');
  });

  it.each(['/Job-Seekers/JS-00001', '/JOB-SEEKERS/JS-00001', '/job-Seekers/JS-00001'])('answers 404 for %s', async (url) => {
    expect((await request(app.getHttpServer()).get(url)).status).toBe(404);
  });

  it('main.ts uses it', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('fs').readFileSync(require('path').join(__dirname, '../../main.ts'), 'utf8') as string;
    expect(source).toContain('caseSensitiveHttpAdapter()');
  });
});
