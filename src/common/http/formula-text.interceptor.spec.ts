import { Body, Controller, INestApplication, Module, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import * as request from 'supertest';
import { Public } from '../rbac/public.decorator';
import { FORMULA_START_CODE, FormulaTextInterceptor, findFormulaStart, startsLikeFormula } from './formula-text.interceptor';

@Controller('t')
class ProbeController {
  @Post('business')
  @Public('test probe')
  create(@Body() body: unknown) {
    return { ok: true, body };
  }

  @Patch('business')
  @Public('test probe')
  edit(@Body() body: unknown) {
    return { ok: true, body };
  }

  @Post('webhook')
  @Public('webhook: the sender is checked by its signature, not a staff login')
  webhook(@Body() body: unknown) {
    return { ok: true, body };
  }

  @Post('upload')
  @Public('test probe')
  @UseInterceptors(FileInterceptor('photo'))
  upload(@UploadedFile() photo: { buffer: Buffer } | undefined, @Body() body: unknown) {
    return { ok: true, bytes: photo?.buffer.length ?? 0, body };
  }
}

@Module({ controllers: [ProbeController], providers: [{ provide: APP_INTERCEPTOR, useClass: FormulaTextInterceptor }] })
class ProbeModule {}

describe('Names and localities may not start like a spreadsheet formula (INF-6)', () => {
  it('spots = + - @ at the start of a name-like field, at any depth', () => {
    expect(startsLikeFormula('=HYPERLINK("x")')).toBe(true);
    expect(startsLikeFormula('  @SUM(A1)')).toBe(true);
    expect(startsLikeFormula('A+ Tailors')).toBe(false);
    expect(findFormulaStart({ name: 'Sri Lakshmi Hotel', locality: 'BTM Layout' })).toBeNull();
    expect(findFormulaStart({ businessName: '+cmd' })).toEqual({ field: 'businessName', label: 'Business name' });
    expect(findFormulaStart({ branches: [{ name: 'Main' }, { contactName: '-1+1' }] })).toEqual({ field: 'branches.1.contactName', label: 'Contact name' });
    expect(findFormulaStart({ locality: '=1+1' })?.label).toBe('Locality');
    // Only names and localities: notes, phone numbers and amounts are not names.
    expect(findFormulaStart({ notes: '=not a name', phone: '+919876543210', amount: '-100' })).toBeNull();
  });

  describe('over HTTP', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(['=HYPERLINK("https://evil.example","x")', '+1+1', '-2+3', '@SUM(A1)'])('refuses a business name %j with a clear 400', async (value) => {
      const res = await request(app.getHttpServer()).post('/t/business').send({ name: value, locality: 'BTM' }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: FORMULA_START_CODE, field: 'name' });
      expect(res.body.message).toMatch(/can't start with =, \+, - or @/);
    });

    it('refuses it on edits too, and for localities and person names', async () => {
      await request(app.getHttpServer()).patch('/t/business').send({ locality: '=1+1' }).expect(400);
      await request(app.getHttpServer()).post('/t/business').send({ ownerName: '@Ravi' }).expect(400);
      await request(app.getHttpServer()).post('/t/business').send({ contactPersonName: '-Ravi' }).expect(400);
    });

    it('lets ordinary names through unchanged', async () => {
      const res = await request(app.getHttpServer()).post('/t/business').send({ name: 'A+ Tailors', ownerName: 'Ravi-Kumar', locality: 'BTM Layout' }).expect(201);
      expect(res.body.body).toEqual({ name: 'A+ Tailors', ownerName: 'Ravi-Kumar', locality: 'BTM Layout' });
    });

    it('never refuses a vendor webhook (the payment or call must still be recorded)', async () => {
      await request(app.getHttpServer()).post('/t/webhook').send({ name: '=odd vendor value' }).expect(201);
    });

    it('does not get in the way of photo uploads', async () => {
      const res = await request(app.getHttpServer()).post('/t/upload').field('source', 'live_camera').attach('photo', Buffer.from('abc'), 'p.jpg').expect(201);
      expect(res.body.bytes).toBe(3);
    });
  });

  it('is registered for the whole app (AppModule), so staff, public-link and customer routes all get it', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../app.module.ts'), 'utf8');
    expect(source).toMatch(/provide:\s*APP_INTERCEPTOR,\s*useClass:\s*FormulaTextInterceptor/);
  });
});
