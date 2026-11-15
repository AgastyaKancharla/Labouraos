import * as fs from 'fs';
import * as path from 'path';
import { STAFF_PHOTO_MAX_BYTES } from '../upload-limits';
import { CARD_PHOTO_MAX_BYTES } from '../../modules/aadhaar-qr/id-card-image';
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from '../../modules/field-visit/field-visit.constants';
import { BILL_CONTENT_TYPES, MAX_BILL_BYTES } from '../../modules/finance/expense-bill.storage';
import { MAX_RECORDING_BYTES } from '../../modules/call/recording-storage';

/**
 * scripts/supabase-storage-limits.sql sets a size limit and the allowed file
 * types on each private bucket (defence in depth). It must let through
 * everything the app writes, and nothing more.
 */
const sql = fs.readFileSync(path.resolve(__dirname, '../../../scripts/supabase-storage-limits.sql'), 'utf8');

function bucket(id: string): { size: number; types: string[]; public: boolean } {
  const re = new RegExp(`UPDATE storage\\.buckets\\s+SET public = (true|false),\\s+file_size_limit = (\\d+),[^\\n]*\\n\\s+allowed_mime_types = ARRAY\\[([^\\]]*)\\]\\s+WHERE id = '${id}';`);
  const m = re.exec(sql);
  if (!m) throw new Error(`No limits for bucket ${id}`);
  return { public: m[1] === 'true', size: Number(m[2]), types: m[3].split(',').map((t) => t.trim().replace(/'/g, '')) };
}

describe('Supabase bucket limits match what the app uploads', () => {
  const photoTypes = Object.keys(PHOTO_TYPES).sort();

  it('every bucket stays private', () => {
    for (const id of ['candidate-photos', 'business-photos', 'agreements', 'recordings']) expect(bucket(id).public).toBe(false);
    expect(sql).not.toMatch(/public\s*=\s*true/i);
  });

  it('candidate-photos: selfies, staff photos and ID photos (JPEG/PNG/WebP, 5 MB)', () => {
    const b = bucket('candidate-photos');
    expect(b.size).toBe(STAFF_PHOTO_MAX_BYTES);
    expect(b.size).toBeGreaterThanOrEqual(CARD_PHOTO_MAX_BYTES);
    expect(b.types.sort()).toEqual(photoTypes);
  });

  it('business-photos: storefront and visit photos (JPEG/PNG/WebP, the largest photo the app accepts)', () => {
    const b = bucket('business-photos');
    expect(b.size).toBe(Math.max(MAX_PHOTO_BYTES, STAFF_PHOTO_MAX_BYTES));
    expect(b.types.sort()).toEqual(photoTypes);
  });

  it('agreements: signed agreement HTML and expense bills (PDF and photos, 10 MB)', () => {
    const b = bucket('agreements');
    expect(b.size).toBe(MAX_BILL_BYTES);
    expect(b.types.sort()).toEqual(['text/html', ...Object.keys(BILL_CONTENT_TYPES)].sort());
  });

  it('recordings: MP3 copies of call recordings, 50 MB', () => {
    const b = bucket('recordings');
    expect(b.size).toBe(MAX_RECORDING_BYTES);
    expect(b.types).toEqual(['audio/mpeg']);
  });
});
