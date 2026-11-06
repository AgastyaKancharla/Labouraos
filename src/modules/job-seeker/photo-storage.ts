export const CANDIDATE_PHOTO_STORAGE = 'CANDIDATE_PHOTO_STORAGE';
export const CANDIDATE_PHOTO_LINK_TTL_SECONDS = 5 * 60;

export interface CandidatePhotoStorage {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export class MemoryCandidatePhotoStorage implements CandidatePhotoStorage {
  private readonly files = new Map<string, Buffer>();

  async put(path: string, body: Buffer): Promise<void> {
    this.files.set(path, Buffer.from(body));
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    return `memory://candidate-photos/${path}?exp=${expiresAt}`;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }
}

/** Private Supabase bucket; the service role key stays on the server. */
export class SupabaseCandidatePhotoStorage implements CandidatePhotoStorage {
  private readonly baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  private readonly bucket = process.env.CANDIDATE_PHOTOS_BUCKET || 'candidate-photos';

  private headers(): Record<string, string> {
    if (!this.baseUrl || !this.serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to store candidate photos');
    }
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }

  async put(path: string, body: Buffer, contentType: string): Promise<void> {
    const objectPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${objectPath}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(body),
    });
    if (!response.ok) throw new Error(`Candidate photo store failed with status ${response.status}`);
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const objectPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${objectPath}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) throw new Error(`Candidate photo sign failed with status ${response.status}`);
    const data = (await response.json()) as { signedURL?: string };
    if (!data.signedURL) throw new Error('Candidate photo sign failed');
    return data.signedURL.startsWith('http') ? data.signedURL : `${this.baseUrl}/storage/v1${data.signedURL}`;
  }
}
