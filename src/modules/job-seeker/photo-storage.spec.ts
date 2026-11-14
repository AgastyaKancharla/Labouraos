import { SupabaseCandidatePhotoStorage } from './photo-storage';

/**
 * H1: a photo must never be believed deleted when it isn't. Only 2xx and 404
 * (already gone) count as deleted; anything else throws so the caller keeps
 * the path and the daily run tries again.
 */
describe('SupabaseCandidatePhotoStorage.delete()', () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://storage.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    fetchMock = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const answer = (status: number) => fetchMock.mockResolvedValueOnce(new Response(null, { status }));

  it('resolves on 200 and 204, and on 404 (already gone)', async () => {
    const storage = new SupabaseCandidatePhotoStorage();
    for (const status of [200, 204, 404]) {
      answer(status);
      await expect(storage.delete('id-card/job_seeker/js-1/v-1.jpg')).resolves.toBeUndefined();
    }
    expect(fetchMock).toHaveBeenCalledWith(
      'https://storage.example.test/storage/v1/object/candidate-photos/id-card/job_seeker/js-1/v-1.jpg',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each([400, 401, 403, 409, 429, 500, 502, 503])('throws on %i (the caller keeps the path and retries)', async (status) => {
    answer(status);
    await expect(new SupabaseCandidatePhotoStorage().delete('aadhaar-qr/job_seeker/js-1/v-1.jpg')).rejects.toThrow(`status ${status}`);
  });

  it('throws when the network fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await expect(new SupabaseCandidatePhotoStorage().delete('aadhaar-qr/job_seeker/js-1/v-1.jpg')).rejects.toThrow('ECONNREFUSED');
  });
});
