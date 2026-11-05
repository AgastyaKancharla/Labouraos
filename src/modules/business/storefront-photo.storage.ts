export const BUSINESS_PHOTO_STORAGE = 'BUSINESS_PHOTO_STORAGE';

export interface BusinessPhotoStorage {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
}

export class MemoryBusinessPhotoStorage implements BusinessPhotoStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(path: string, body: Buffer): Promise<void> {
    this.objects.set(path, Buffer.from(body));
  }

  has(path: string): boolean {
    return this.objects.has(path);
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
}
