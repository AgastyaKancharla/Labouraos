import { File, Paths } from 'expo-file-system';

/**
 * Pretend-data builds (EXPO_PUBLIC_API_MODE=mock) keep their pretend server
 * in a file on the phone, so closing and opening the app keeps the account,
 * the registrations and the steps — as the real server does (Agastya, 22 Nov:
 * the first test APK "forgot" a finished registration on reopening).
 * Live builds never use this.
 */
export interface MockPersist {
  load(): Promise<string | null>;
  save(json: string): void;
}

export function fileMockPersist(name: string): MockPersist {
  const file = () => new File(Paths.document, name);
  return {
    async load() {
      try {
        const f = file();
        return f.exists ? await f.text() : null;
      } catch {
        return null;
      }
    },
    save(json) {
      try {
        const f = file();
        if (!f.exists) f.create();
        f.write(json);
      } catch {
        // A pretend build that cannot save just forgets on close, as before.
      }
    },
  };
}
