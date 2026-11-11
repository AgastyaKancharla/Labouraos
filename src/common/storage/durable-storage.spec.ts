import { NestFactory } from '@nestjs/core';
import {
  assertDurableUploadStorage,
  UPLOAD_STORAGE_MODE_SETTINGS,
} from './durable-storage';
import { bootstrap } from '../../main';
import { bootstrapWorker } from '../../worker';

const durableEnv = {
  NODE_ENV: 'production',
  CANDIDATE_PHOTO_STORAGE_MODE: 'supabase',
  BUSINESS_PHOTO_STORAGE_MODE: 'supabase',
  AGREEMENT_STORAGE_MODE: 'supabase',
  RECORDING_STORAGE_MODE: 'supabase',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

describe('Production refuses to keep uploaded files in memory', () => {
  it('names exactly the four upload storage settings', () => {
    expect([...UPLOAD_STORAGE_MODE_SETTINGS].sort()).toEqual([
      'AGREEMENT_STORAGE_MODE',
      'BUSINESS_PHOTO_STORAGE_MODE',
      'CANDIDATE_PHOTO_STORAGE_MODE',
      'RECORDING_STORAGE_MODE',
    ]);
  });

  it('starts when all four are supabase and the Supabase keys are set', () => {
    expect(() => assertDurableUploadStorage({ ...durableEnv })).not.toThrow();
  });

  it.each(UPLOAD_STORAGE_MODE_SETTINGS)('refuses when %s is unset', (name) => {
    const env: NodeJS.ProcessEnv = { ...durableEnv };
    delete env[name];
    expect(() => assertDurableUploadStorage(env)).toThrow(
      new RegExp(`Refusing to start in production.*${name}=\\(not set\\)`),
    );
  });

  it('refuses an explicit memory or mock mode and lists every offending setting', () => {
    const env = {
      ...durableEnv,
      CANDIDATE_PHOTO_STORAGE_MODE: 'mock',
      RECORDING_STORAGE_MODE: 'memory',
    };
    expect(() => assertDurableUploadStorage(env)).toThrow(
      /CANDIDATE_PHOTO_STORAGE_MODE=mock, RECORDING_STORAGE_MODE=memory\).*Set CANDIDATE_PHOTO_STORAGE_MODE, RECORDING_STORAGE_MODE to "supabase" on both the web service and the worker/,
    );
  });

  it('refuses when storage is supabase but the Supabase keys are missing', () => {
    const env: NodeJS.ProcessEnv = { ...durableEnv };
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertDurableUploadStorage(env)).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY is empty/,
    );
  });

  it.each(['development', 'test', undefined])(
    'allows in-memory storage when NODE_ENV is %s',
    (nodeEnv) => {
      const env: NodeJS.ProcessEnv = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
      expect(() => assertDurableUploadStorage(env)).not.toThrow();
    },
  );

  describe('both entry points run the check before booting', () => {
    const saved = { ...process.env };

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.PUBLIC_APP_URL = 'https://app.laboura.in';
      for (const name of UPLOAD_STORAGE_MODE_SETTINGS) delete process.env[name];
    });

    afterEach(() => {
      process.env = { ...saved };
      jest.restoreAllMocks();
    });

    it('the web server refuses to start', async () => {
      const create = jest.spyOn(NestFactory, 'create');
      await expect(bootstrap()).rejects.toThrow(/Refusing to start in production/);
      expect(create).not.toHaveBeenCalled();
    });

    it('the worker refuses to start', async () => {
      const create = jest.spyOn(NestFactory, 'createApplicationContext');
      await expect(bootstrapWorker()).rejects.toThrow(/Refusing to start in production/);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
