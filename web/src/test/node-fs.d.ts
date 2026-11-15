// Test-only: the two Node APIs a test reads a fixture file with (the app itself never runs in Node).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare const process: { cwd(): string };
