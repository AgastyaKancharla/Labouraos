import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MAPS_DNS, MAPS_HTTP, MapsFetch } from './maps-link.service';

jest.setTimeout(120000);

/** POST /maps-link/resolve (17 Nov): field agents only; no real network in tests. */
describe('POST /maps-link/resolve', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const stamp = Date.now();
  const ids: string[] = [];
  const fetched: string[] = [];
  const fakeFetch: MapsFetch = async (url) => {
    fetched.push(url);
    if (url.startsWith('https://maps.app.goo.gl/')) {
      return { status: 302, headers: { get: () => 'https://www.google.com/maps/place/Shop/@12.9,77.6,17z/data=!3d12.9116!4d77.6101' }, json: async () => ({}) };
    }
    return {
      status: 200,
      headers: { get: () => null },
      json: async () => ({ display_name: 'JP Nagar', address: { road: '24th Main Road', suburb: 'JP Nagar', city: 'Bengaluru', postcode: '560078' } }),
    };
  };

  const make = async (role: string) => {
    const s = await prisma.staff.create({
      data: { code: `ML-${role.slice(0, 2)}-${stamp}-${ids.length}`, name: `Maps ${role}`, email: `maps-${role}-${stamp}-${ids.length}@laboura.local`, passwordHash: 'x', role, status: 'active' },
    });
    ids.push(s.id);
    return s;
  };
  const post = (who: { id: string; role: string; code: string }, body: unknown) =>
    request(app.getHttpServer())
      .post('/maps-link/resolve')
      .set('Authorization', `Bearer ${jwt.sign({ sub: who.id, role: who.role, code: who.code, email: null })}`)
      .send(body as object);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAPS_HTTP).useValue(fakeFetch)
      .overrideProvider(MAPS_DNS).useValue(async () => ['142.250.183.14'])
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await prisma.staff.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('a field agent gets the pin and the address; other roles and no login are refused', async () => {
    const agent = await make('field_agent');
    const res = await post(agent, { url: 'Shop https://maps.app.goo.gl/XyZ123' }).expect(200);
    expect(res.body).toMatchObject({ latitude: 12.9116, longitude: 77.6101, placeName: 'Shop', shortLink: true, address: { street: '24th Main Road', area: 'JP Nagar', pincode: '560078' } });
    expect(fetched[0]).toBe('https://maps.app.goo.gl/XyZ123');
    expect(fetched[1]).toMatch(/^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
    const bad = await post(agent, { url: 'https://example.com/maps/@12.9,77.6' }).expect(400);
    expect(bad.body.code ?? bad.body.details?.code).toBe('MAPS_LINK_INVALID');
    expect(fetched).toHaveLength(2);
    for (const role of ['call_agent', 'team_lead']) await post(await make(role), { url: 'https://maps.google.com/?q=12.9,77.6' }).expect(403);
    await request(app.getHttpServer()).post('/maps-link/resolve').send({ url: 'https://maps.google.com/?q=12.9,77.6' }).expect(401);
  });
});
