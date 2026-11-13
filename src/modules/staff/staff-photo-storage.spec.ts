import { assertDurableUploadStorage } from '../../common/storage/durable-storage';
import { SupabaseCandidatePhotoStorage, sharedCandidatePhotoStorage } from '../job-seeker/photo-storage';
import { staffPhotoStorage } from './staff-photo.module';

describe('Staff photo storage', () => {
  it('uses the private Supabase bucket when selfies do, memory only outside it', () => {
    expect(staffPhotoStorage({ CANDIDATE_PHOTO_STORAGE_MODE: 'supabase' } as NodeJS.ProcessEnv)).toBeInstanceOf(SupabaseCandidatePhotoStorage);
    expect(staffPhotoStorage({} as NodeJS.ProcessEnv)).toBe(sharedCandidatePhotoStorage);
  });

  it('production refuses to start when staff photos would be kept in memory', () => {
    const env = {
      NODE_ENV: 'production',
      CANDIDATE_PHOTO_STORAGE_MODE: 'mock',
      BUSINESS_PHOTO_STORAGE_MODE: 'supabase',
      AGREEMENT_STORAGE_MODE: 'supabase',
      RECORDING_STORAGE_MODE: 'supabase',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
    } as NodeJS.ProcessEnv;
    expect(() => assertDurableUploadStorage(env)).toThrow(/CANDIDATE_PHOTO_STORAGE_MODE/);
  });
});
