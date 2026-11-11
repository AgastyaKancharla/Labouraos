import type { QueuedFile } from './types';

/** "data:image/jpeg;base64,…" → Blob, without fetch (works offline and in tests). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Not a data URL');
  const type = match[1] ?? 'application/octet-stream';
  const data = match[3];
  if (!match[2]) return new Blob([decodeURIComponent(data)], { type });
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Web app: queued photos are data URLs; send them as real files. */
export async function appendFile(form: FormData, file: QueuedFile): Promise<void> {
  const blob = file.uri.startsWith('data:') ? dataUrlToBlob(file.uri) : await (await fetch(file.uri)).blob();
  form.append(file.field, blob, file.name);
}
