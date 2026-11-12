export const BUSINESS_PHOTO_STORAGE = 'BUSINESS_PHOTO_STORAGE';

export interface BusinessPhotoStorage {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  /**
   * A short-lived link to a private photo, for a person already allowed to
   * see it (the Team Lead checking a visit). Never a public URL.
   */
  signedUrl?(path: string, expiresInSeconds: number): Promise<string | null>;
}

/** How long a visit-photo link works. */
export const BUSINESS_PHOTO_LINK_TTL_SECONDS = 5 * 60;

/**
 * Preview/test storage. Every instance shares one store, so a photo the field
 * visit module saved can be read by the Team Lead's screen in the same process.
 */
const memoryObjects = new Map<string, { body: Buffer; contentType: string }>();

export class MemoryBusinessPhotoStorage implements BusinessPhotoStorage {
  async put(path: string, body: Buffer, contentType = 'image/jpeg'): Promise<void> {
    memoryObjects.set(path, { body: Buffer.from(body), contentType });
  }

  has(path: string): boolean {
    return memoryObjects.has(path);
  }

  /** In preview mode the "link" carries the bytes (a data: URI), so nothing is ever served publicly. */
  async signedUrl(path: string): Promise<string | null> {
    const object = memoryObjects.get(path);
    if (!object) return null;
    return `data:${object.contentType};base64,${object.body.toString('base64')}`;
  }
}

/** Private Supabase bucket; the service role key remains server-side. */
export class SupabaseBusinessPhotoStorage implements BusinessPhotoStorage {
  private readonly baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  private readonly bucket = process.env.BUSINESS_PHOTOS_BUCKET || 'business-photos';

  async put(path: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.baseUrl || !this.serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for private business photo storage');
    }
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        apikey: this.serviceKey,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: new Uint8Array(body),
    });
    if (!response.ok) {
      throw new Error(`Business photo storage failed with status ${response.status}`);
    }
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    if (!this.baseUrl || !this.serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for private business photo storage');
    }
    const objectPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${objectPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) throw new Error(`Business photo sign failed with status ${response.status}`);
    const data = (await response.json()) as { signedURL?: string };
    if (!data.signedURL) return null;
    return data.signedURL.startsWith('http') ? data.signedURL : `${this.baseUrl}/storage/v1${data.signedURL}`;
  }
}
