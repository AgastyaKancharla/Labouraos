export const AGREEMENT_DOCUMENT_STORAGE = 'AGREEMENT_DOCUMENT_STORAGE';

export interface AgreementDocumentStorage {
  put(path: string, body: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer | undefined>;
  delete(path: string): Promise<void>;
}

export class MemoryAgreementDocumentStorage implements AgreementDocumentStorage {
  private readonly documents = new Map<string, Buffer>();

  async put(path: string, body: Buffer, _contentType?: string): Promise<void> {
    this.documents.set(path, Buffer.from(body));
  }

  async get(path: string): Promise<Buffer | undefined> {
    const body = this.documents.get(path);
    return body ? Buffer.from(body) : undefined;
  }

  async delete(path: string): Promise<void> {
    this.documents.delete(path);
  }

  has(path: string): boolean {
    return this.documents.has(path);
  }
}

export const sharedMemoryAgreementDocumentStorage = new MemoryAgreementDocumentStorage();

/** Private Supabase Storage bucket; the service-role key stays on the server. */
export class SupabaseAgreementDocumentStorage implements AgreementDocumentStorage {
  private readonly baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  private readonly serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  private readonly bucket = process.env.AGREEMENTS_BUCKET || 'agreements';

  async put(path: string, body: Buffer, contentType: string): Promise<void> {
    if (!this.baseUrl || !this.serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to store agreements');
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
    if (!response.ok) throw new Error(`Agreement store failed with status ${response.status}`);
  }

  async get(path: string): Promise<Buffer | undefined> {
    if (!this.baseUrl || !this.serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read agreements');
    }
    const objectPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${objectPath}`, {
      headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Agreement read failed with status ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    if (!this.baseUrl || !this.serviceKey) return;
    const objectPath = path.split('/').map(encodeURIComponent).join('/');
    await fetch(`${this.baseUrl}/storage/v1/object/${this.bucket}/${objectPath}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey },
    });
  }
}
