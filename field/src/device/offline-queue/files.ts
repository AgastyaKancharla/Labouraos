import { Directory, File, Paths } from 'expo-file-system';
import type { FileKeeper } from './queue';

/**
 * Phone app: camera photos land in the cache folder, which the system may
 * empty. Queued photos are copied to the app's documents folder and deleted
 * once sent.
 */
export const fileKeeper: FileKeeper = {
  async persist(uri, itemId, index) {
    if (!uri.startsWith('file://')) return uri;
    const dir = new Directory(Paths.document, 'queue');
    dir.create({ idempotent: true, intermediates: true });
    const source = new File(uri);
    const target = new File(dir, `${itemId}-${index}-${source.name}`);
    await source.copy(target);
    return target.uri;
  },
  async discard(uri) {
    if (!uri.startsWith('file://')) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  },
};
