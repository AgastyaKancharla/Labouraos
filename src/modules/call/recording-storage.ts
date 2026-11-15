import { request as httpsRequest } from 'node:https';
import { checkRecordingUrl, publicOnlyLookup, recordingHostAllowList, RecordingUrlRefusedError } from './recording-url-policy';

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

/** Largest recording copied (Supabase's free-plan per-file limit; the recordings bucket is capped the same). */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const RECORDING_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

/** One GET, without following redirects (tests replace it). */
export type RecordingGet = (url: URL, lookup: ReturnType<typeof publicOnlyLookup>) => Promise<{ status: number; location?: string; body: AsyncIterable<Buffer> & { destroy?: () => void } }>;

const httpsGet: RecordingGet = (url, lookup) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', lookup: lookup as never, timeout: RECORDING_DOWNLOAD_TIMEOUT_MS }, (res) => {
      const location = res.headers.location;
      resolve({ status: res.statusCode ?? 0, location: typeof location === 'string' ? location : undefined, body: res });
    });
    req.on('timeout', () => req.destroy(new Error('Recording download timed out')));
    req.on('error', reject);
    req.end();
  });

/**
 * Downloads a provider recording under the IN-4 rules (recording-url-policy.ts):
 * https only, a host on RECORDING_URL_HOSTS, never an internal address (also
 * after DNS, at connect time), at most 3 redirects, at most 50 MB.
 */
export class HttpRecordingDownloader implements RecordingDownloader {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly get: RecordingGet = httpsGet,
    private readonly lookup = publicOnlyLookup(),
  ) {}

  async download(rawUrl: string): Promise<Buffer> {
    const allowList = recordingHostAllowList(this.env);
    let url = checkRecordingUrl(rawUrl, allowList);
    for (let hop = 0; ; hop += 1) {
      const res = await this.get(url, this.lookup);
      if (res.status >= 300 && res.status < 400 && res.location) {
        res.body.destroy?.();
        if (hop >= MAX_REDIRECTS) throw new RecordingUrlRefusedError('too many redirects');
        url = checkRecordingUrl(new URL(res.location, url).toString(), allowList);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.body.destroy?.();
        throw new Error(`Recording download failed with status ${res.status}`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_RECORDING_BYTES) {
          res.body.destroy?.();
          throw new RecordingUrlRefusedError('the recording is larger than 50 MB');
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
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
