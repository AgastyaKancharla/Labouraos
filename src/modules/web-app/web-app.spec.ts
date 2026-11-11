import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { CloudflareAccessGuard } from '../../common/auth/cloudflare-access.guard';
import { WebAppController } from './web-app.controller';
import { resolveWebAppFile } from './web-app.files';

describe('Web app at /app (React portals)', () => {
  let dist: string;
  let app: INestApplication;
  let allowStaff = true;
  const previous = process.env.WEB_DIST_DIR;

  beforeAll(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'laboura-web-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
    fs.writeFileSync(path.join(dist, 'favicon.png'), 'png');
    fs.writeFileSync(path.join(os.tmpdir(), 'laboura-secret.txt'), 'TOP-SECRET-CONTENT');
    process.env.WEB_DIST_DIR = dist;

    const moduleRef = await Test.createTestingModule({ controllers: [WebAppController] })
      .overrideGuard(CloudflareAccessGuard)
      .useValue({ canActivate: () => allowStaff })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.WEB_DIST_DIR = previous;
    fs.rmSync(dist, { recursive: true, force: true });
  });

  beforeEach(() => {
    allowStaff = true;
  });

  it('serves index.html for the app root and every screen URL, never cached', async () => {
    for (const url of ['/app', '/app/', '/app/ceo', '/app/ceo/refunds', '/app/call-agent/register/job-seeker/JS-00203', '/app/login']) {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('<div id="root">');
    }
  });

  it('serves hashed assets with a long cache and the right type', async () => {
    const res = await request(app.getHttpServer()).get('/app/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404, not HTML, for a missing file', async () => {
    expect((await request(app.getHttpServer()).get('/app/assets/missing.js')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/app/robots.txt')).status).toBe(404);
  });

  it('never serves files outside web/dist', async () => {
    const res = await request(app.getHttpServer()).get('/app/%2e%2e/laboura-secret.txt');
    expect(res.text).not.toContain('TOP-SECRET-CONTENT');
    expect(resolveWebAppFile(dist, '/app/../laboura-secret.txt')).toEqual({ kind: 'missing' });
    expect(resolveWebAppFile(dist, '/app/%2e%2e%2flaboura-secret.txt')).toEqual({ kind: 'missing' });
    expect(resolveWebAppFile(dist, '/app/%E0%A4%A')).toEqual({ kind: 'missing' });
  });

  it('keeps the staff portals behind Cloudflare Access but leaves the public pages open', async () => {
    allowStaff = false;
    expect((await request(app.getHttpServer()).get('/app/ceo')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/app/login')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/app/p/register/tok123')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/app/p')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/app/assets/index-abc123.js')).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/app/favicon.png')).status).toBe(200);
  });

  it('does not answer anything outside /app', async () => {
    expect((await request(app.getHttpServer()).get('/application')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/admin')).status).toBe(404);
  });

  it('says so clearly when the web app was not built', async () => {
    process.env.WEB_DIST_DIR = path.join(dist, 'not-built');
    try {
      const res = await request(app.getHttpServer()).get('/app/ceo');
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/not been built/);
    } finally {
      process.env.WEB_DIST_DIR = dist;
    }
  });
});
