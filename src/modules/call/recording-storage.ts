export const RECORDING_STORAGE = 'RECORDING_STORAGE';
export const RECORDING_DOWNLOADER = 'RECORDING_DOWNLOADER';

/** Signed listen links last 5 minutes. */
export const RECORDING_LINK_TTL_SECONDS = 5 * 60;

export interface RecordingStorage {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  delete(path: string): Promise<void>;
}

export interface RecordingDownloader {
  download(url: string): Promise<Buffer>;
}

export class MemoryRecordingStorage implements RecordingStorage {
  private readonly files = new Map<string, Buffer>();

  async put(path: string, body: Buffer, contentType?: string): Promise<void> {
    void contentType;
    this.files.set(path, Buffer.from(body));
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    return `memory://${path}?exp=${expiresAt}`;
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path);
  }

  has(path: string): boolean {
    return this.files.has(path);
  }
}

export const sharedMemoryRecordingStorage = new MemoryRecordingStorage();

export class HttpRecordingDownloader implements RecordingDownloader {
  async download(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Recording download failed with status ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

/** Private Supabase Storage bucket. The service-role key stays on the server. */
export class SupabaseRecordingStorage implements RecordingStorage {
  private readonly baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  private readonly bucket = process.env.RECORDINGS_BUCKET || 'recordings';

  private headers(): Record<string, string> {
    if (!this.baseUrl || !this.serviceKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to store call recordings',
      );
    }
    return {
      Authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
    };
  }

  async put(path: string, body: Buffer, contentType: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${this.bucket}/${path}`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: new Uint8Array(body),
      },
    );
    if (!response.ok) {
      throw new Error(`Recording store failed with status ${response.status}`);
    }
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/sign/${this.bucket}/${path}`,
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      },
    );
    if (!response.ok) {
      throw new Error(`Recording sign failed with status ${response.status}`);
    }
    const data = (await response.json()) as { signedURL?: string };
    if (!data.signedURL) {
      throw new Error('Recording sign failed');
    }
    if (data.signedURL.startsWith('http')) {
      return data.signedURL;
    }
    return `${this.baseUrl}/storage/v1${data.signedURL}`;
  }

  async delete(path: string): Promise<void> {
    if (!this.baseUrl || !this.serviceKey) return;
    const objectPath = path.split('/').map(encodeURIComponent).join('/');
    await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${objectPath}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }
}
