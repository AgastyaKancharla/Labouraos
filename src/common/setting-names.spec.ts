import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const yaml = require('js-yaml') as { load: (content: string) => unknown };

/**
 * Each setting has one name, used the same way in the code, in .env.example
 * and in render.yaml. A setting declared in render.yaml or .env.example that
 * the code never reads is a typo or a leftover, and would silently do nothing.
 */
const rootDir = path.resolve(__dirname, '../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Every setting name the application reads. */
function namesReadByCode(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(path.join(rootDir, 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    for (const m of source.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)) names.add(m[1]);
    // Names held in constants, e.g. TRUST_PROXY_ENV = 'TRUST_PROXY_HOPS',
    // or arrays of setting names read through env[name].
    for (const m of source.matchAll(/['"]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)['"]/g)) names.add(m[1]);
  }
  const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
  for (const m of schema.matchAll(/env\("([A-Z][A-Z0-9_]*)"\)/g)) names.add(m[1]);
  return names;
}

interface EnvVar {
  key?: string;
}
interface Service {
  type: string;
  name: string;
  envVars?: EnvVar[];
}

function renderServices(): Service[] {
  const blueprint = yaml.load(fs.readFileSync(path.join(rootDir, 'render.yaml'), 'utf8')) as {
    services: Service[];
  };
  return blueprint.services;
}

function renderKeys(): string[] {
  return renderServices().flatMap((s) => (s.envVars ?? []).map((v) => v.key ?? '')).filter(Boolean);
}

function envExampleKeys(): string[] {
  return fs
    .readFileSync(path.join(rootDir, '.env.example'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim());
}

const RETIRED_NAMES = [
  'MSG91_AUTH_KEY',
  'OTP_API_KEY',
  'SMS_SENDER_ID',
  'OVSE_API_KEY',
  'OVSE_API_URL',
  'OVSE_KYC_API_KEY',
  'OVSE_KYC_API_URL',
  'WHATSAPP_API_KEY',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'TELEPHONY_API_KEY',
  'TRUSTED_PROXY_HOPS',
];

describe('Each setting has one name across code, .env.example and render.yaml', () => {
  const read = namesReadByCode();

  it('every render.yaml setting is read by the code', () => {
    const unread = [...new Set(renderKeys())].filter((key) => !read.has(key));
    expect(unread).toEqual([]);
  });

  it('every .env.example setting is read by the code', () => {
    const unread = envExampleKeys().filter((key) => !read.has(key));
    expect(unread).toEqual([]);
  });

  it('.env.example lists every setting render.yaml sets', () => {
    const documented = new Set(envExampleKeys());
    const missing = [...new Set(renderKeys())].filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });

  it.each(RETIRED_NAMES)('the retired name %s is gone from config and code', (name) => {
    expect(renderKeys()).not.toContain(name);
    expect(envExampleKeys()).not.toContain(name);
    for (const file of sourceFiles(path.join(rootDir, 'src'))) {
      expect(`${path.relative(rootDir, file)}: ${fs.readFileSync(file, 'utf8')}`).not.toMatch(
        new RegExp(`process\\.env\\.${name}\\b`),
      );
    }
  });

  it.each(['OTP', 'WHATSAPP', 'TELEPHONY', 'KYC'])(
    'the %s vendor is chosen only by its _PROVIDER_MODE setting (no second switch)',
    (vendor) => {
      for (const file of sourceFiles(path.join(rootDir, 'src'))) {
        const source = fs.readFileSync(file, 'utf8');
        expect(source).not.toMatch(new RegExp(`process\\.env\\.${vendor}_PROVIDER(?!_)\\b`));
      }
    },
  );
});
