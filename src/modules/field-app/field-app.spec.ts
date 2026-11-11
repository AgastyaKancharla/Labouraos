import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as request from 'supertest';
import { PUBLIC_ROUTE_KEY } from '../../common/rbac/public.decorator';
import { FieldAppController } from './field-app.controller';
import { resolveFieldAppFile } from './field-app.files';

describe('Laboura Field web app at /field', () => {
  let dist: string;
  let app: INestApplication;
  const previous = process.env.FIELD_DIST_DIR;

  beforeAll(async () => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'laboura-field-'));
    fs.mkdirSync(path.join(dist, '_expo', 'static', 'js', 'web'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'icons'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry-abc123.js'), 'console.log("field")');
    fs.writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {})');
    fs.writeFileSync(path.join(dist, 'register-sw.js'), 'navigator.serviceWorker.register("/field/sw.js")');
    fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{"name":"Laboura Field"}');
    fs.writeFileSync(path.join(dist, 'icons', 'icon-192.png'), 'png');
    fs.writeFileSync(path.join(os.tmpdir(), 'laboura-field-secret.txt'), 'TOP-SECRET-CONTENT');
    process.env.FIELD_DIST_DIR = dist;

    const moduleRef = await Test.createTestingModule({ controllers: [FieldAppController] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.FIELD_DIST_DIR = previous;
    fs.rmSync(dist, { recursive: true, force: true });
  });

  it('serves index.html for the app root and every screen URL, never cached', async () => {
    for (const url of ['/field', '/field/', '/field/login', '/field/login-code', '/field/visits', '/field/visit/start']) {
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('<div id="root">');
    }
  });

  it('caches hashed bundles forever with the right type', async () => {
    const res = await request(app.getHttpServer()).get('/field/_expo/static/js/web/entry-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('never caches the service worker, its installer or the manifest', async () => {
    const sw = await request(app.getHttpServer()).get('/field/sw.js');
    expect(sw.status).toBe(200);
    expect(sw.headers['cache-control']).toBe('no-cache');
    expect(sw.headers['service-worker-allowed']).toBe('/field/');
    expect(sw.headers['content-type']).toMatch(/javascript/);
    expect((await request(app.getHttpServer()).get('/field/register-sw.js')).headers['cache-control']).toBe('no-cache');
    const manifest = await request(app.getHttpServer()).get('/field/manifest.webmanifest');
    expect(manifest.status).toBe(200);
    expect(manifest.headers['cache-control']).toBe('no-cache');
    expect(manifest.headers['content-type']).toMatch(/application\/manifest\+json/);
  });

  it('answers 404, not HTML, for a missing file', async () => {
    expect((await request(app.getHttpServer()).get('/field/_expo/static/js/web/missing.js')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/field/robots.txt')).status).toBe(404);
  });

  it('never serves files outside field/dist', async () => {
    const res = await request(app.getHttpServer()).get('/field/%2e%2e/laboura-field-secret.txt');
    expect(res.text).not.toContain('TOP-SECRET-CONTENT');
    expect(resolveFieldAppFile(dist, '/field/../laboura-field-secret.txt')).toEqual({ kind: 'missing' });
    expect(resolveFieldAppFile(dist, '/field/%2e%2e%2flaboura-field-secret.txt')).toEqual({ kind: 'missing' });
    expect(resolveFieldAppFile(dist, '/field/%E0%A4%A')).toEqual({ kind: 'missing' });
  });

  it('does not answer the old console or anything outside /field', async () => {
    expect((await request(app.getHttpServer()).get('/field-agent')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/fieldx')).status).toBe(404);
  });

  it('is marked public with a reason (field agents work outside the office network)', () => {
    const reason = Reflect.getMetadata(PUBLIC_ROUTE_KEY, FieldAppController.prototype.serve) as string | undefined;
    expect(reason).toMatch(/no data/);
  });

  it('says so clearly when the app was not built', async () => {
    process.env.FIELD_DIST_DIR = path.join(dist, 'not-built');
    try {
      const res = await request(app.getHttpServer()).get('/field/login');
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/not been built/);
    } finally {
      process.env.FIELD_DIST_DIR = dist;
    }
  });
});
