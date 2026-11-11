import type { QueuedFile } from './types';

/** Phone app: React Native's FormData takes { uri, name, type } for a file. */
export async function appendFile(form: FormData, file: QueuedFile): Promise<void> {
  form.append(file.field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
}
