import type { FileKeeper } from './queue';

/** Web app: photos are data URLs stored inside the IndexedDB item itself. */
export const fileKeeper: FileKeeper = {
  persist: async (uri) => uri,
  discard: async () => undefined,
};
