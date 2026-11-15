import { Readable } from 'node:stream';
import { UnrecoverableError } from 'bullmq';
import { HttpRecordingDownloader, MAX_RECORDING_BYTES, type RecordingGet } from './recording-storage';
import {
  checkRecordingUrl,
  hostAllowed,
  isPublicAddress,
  publicOnlyLookup,
  recordingHostAllowList,
  RecordingUrlRefusedError,
} from './recording-url-policy';
import { RecordingCopyJob } from './recording-copy.job';

const ALLOW = ['recordings.vendor.example', '*.cdn.vendor.example'];
const env = { RECORDING_URL_HOSTS: ' recordings.vendor.example , *.cdn.vendor.example ' } as NodeJS.ProcessEnv;

describe('Recording download address rules (IN-4, SSRF)', () => {
  it('reads the provider host allow-list from RECORDING_URL_HOSTS', () => {
    expect(recordingHostAllowList(env)).toEqual(ALLOW);
    expect(recordingHostAllowList({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(hostAllowed('recordings.vendor.example', ALLOW)).toBe(true);
    expect(hostAllowed('eu.cdn.vendor.example', ALLOW)).toBe(true);
    expect(hostAllowed('cdn.vendor.example', ALLOW)).toBe(false);
    expect(hostAllowed('recordings.vendor.example.evil.test', ALLOW)).toBe(false);
    expect(hostAllowed('evilcdn.vendor.example', ALLOW)).toBe(false);
  });

  it.each([
    ['http://recordings.vendor.example/a.mp3', /only https/],
    ['https://user:pw@recordings.vendor.example/a.mp3', /user name or password/],
    ['https://recordings.vendor.example:8443/a.mp3', /standard https port/],
    ['https://other.example/a.mp3', /not on RECORDING_URL_HOSTS/],
    ['https://169.254.169.254/latest/meta-data/', /private, loopback or link-local/],
    ['https://127.0.0.1/a.mp3', /private, loopback or link-local/],
    ['https://[::1]/a.mp3', /private, loopback or link-local/],
    ['https://10.1.2.3/a.mp3', /private, loopback or link-local/],
    ['file:///etc/passwd', /only https/],
    ['not a url', /not a valid address/],
  ])('refuses %s', (url, reason) => {
    expect(() => checkRecordingUrl(url, ALLOW)).toThrow(RecordingUrlRefusedError);
    expect(() => checkRecordingUrl(url, ALLOW)).toThrow(reason);
  });

  it('refuses everything while no host is allowed (fails closed)', () => {
    expect(() => checkRecordingUrl('https://recordings.vendor.example/a.mp3', [])).toThrow(/RECORDING_URL_HOSTS is not set/);
  });

  it('accepts an https address on the allow-list', () => {
    expect(checkRecordingUrl('https://recordings.vendor.example/a.mp3?sig=1', ALLOW).hostname).toBe('recordings.vendor.example');
  });

  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', 'ff02::1', '64:ff9b::a00:1', '2002:a00:1::1', 'not-an-ip',
  ])('%s is not a public address', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111'])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  describe('after DNS (checked at connect time)', () => {
    const lookupWith = (addresses: Array<{ address: string; family: number }>) =>
      publicOnlyLookup((_host, cb) => cb(null, addresses));
    const run = (lookup: ReturnType<typeof publicOnlyLookup>) =>
      new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) => lookup('recordings.vendor.example', {}, (err, address) => resolve({ err, address })));

    it('refuses an allowed name that resolves to an internal address', async () => {
      const { err } = await run(lookupWith([{ address: '169.254.169.254', family: 4 }]));
      expect(err).toBeInstanceOf(RecordingUrlRefusedError);
    });

    it('refuses when any one of the answers is internal (no picking the good one)', async () => {
      const { err } = await run(lookupWith([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }]));
      expect(err).toBeInstanceOf(RecordingUrlRefusedError);
    });

    it('connects to a public answer', async () => {
      const { err, address } = await run(lookupWith([{ address: '8.8.8.8', family: 4 }]));
      expect(err).toBeNull();
      expect(address).toBe('8.8.8.8');
    });
  });

  describe('the downloader', () => {
    const body = (bytes: Buffer) => Readable.from([bytes]);

    it('never makes a request for a refused address', async () => {
      const get = jest.fn<ReturnType<RecordingGet>, Parameters<RecordingGet>>();
      const downloader = new HttpRecordingDownloader(env, get);
      await expect(downloader.download('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(RecordingUrlRefusedError);
      await expect(downloader.download('http://recordings.vendor.example/a.mp3')).rejects.toThrow(RecordingUrlRefusedError);
      await expect(new HttpRecordingDownloader({} as NodeJS.ProcessEnv, get).download('https://recordings.vendor.example/a.mp3')).rejects.toThrow(/not set/);
      expect(get).not.toHaveBeenCalled();
    });

    it('downloads an allowed recording, passing the public-only DNS check to the connection', async () => {
      const get: RecordingGet = jest.fn(async () => ({ status: 200, body: body(Buffer.from('audio')) }));
      const lookup = publicOnlyLookup();
      const bytes = await new HttpRecordingDownloader(env, get, lookup).download('https://recordings.vendor.example/a.mp3');
      expect(bytes.toString()).toBe('audio');
      expect(get).toHaveBeenCalledWith(expect.any(URL), lookup);
    });

    it('checks every redirect: an allowed host may not bounce the server to an internal or other host', async () => {
      const toInternal: RecordingGet = jest.fn(async () => ({ status: 302, location: 'https://127.0.0.1/admin', body: body(Buffer.alloc(0)) }));
      await expect(new HttpRecordingDownloader(env, toInternal).download('https://recordings.vendor.example/a.mp3')).rejects.toThrow(/private, loopback/);
      const toOther: RecordingGet = jest.fn(async () => ({ status: 301, location: 'https://evil.example/x', body: body(Buffer.alloc(0)) }));
      await expect(new HttpRecordingDownloader(env, toOther).download('https://recordings.vendor.example/a.mp3')).rejects.toThrow(/not on RECORDING_URL_HOSTS/);
      const toHttp: RecordingGet = jest.fn(async () => ({ status: 302, location: 'http://recordings.vendor.example/a.mp3', body: body(Buffer.alloc(0)) }));
      await expect(new HttpRecordingDownloader(env, toHttp).download('https://recordings.vendor.example/a.mp3')).rejects.toThrow(/only https/);
    });

    it('follows an allowed redirect, at most 3 times', async () => {
      let calls = 0;
      const hop: RecordingGet = jest.fn(async (url: URL) => {
        calls += 1;
        return url.hostname === 'eu.cdn.vendor.example'
          ? { status: 200, body: body(Buffer.from('ok')) }
          : { status: 302, location: 'https://eu.cdn.vendor.example/a.mp3', body: body(Buffer.alloc(0)) };
      });
      expect((await new HttpRecordingDownloader(env, hop).download('https://recordings.vendor.example/a.mp3')).toString()).toBe('ok');
      expect(calls).toBe(2);
      const loop: RecordingGet = jest.fn(async () => ({ status: 302, location: 'https://recordings.vendor.example/a.mp3', body: body(Buffer.alloc(0)) }));
      await expect(new HttpRecordingDownloader(env, loop).download('https://recordings.vendor.example/a.mp3')).rejects.toThrow(/too many redirects/);
      expect(loop).toHaveBeenCalledTimes(4);
    });

    it('with the real https client, an allow-listed name that resolves to loopback is refused at connect time', async () => {
      const downloader = new HttpRecordingDownloader({ RECORDING_URL_HOSTS: 'localhost' } as NodeJS.ProcessEnv);
      await expect(downloader.download('https://localhost/recording.mp3')).rejects.toThrow(/resolves to a private, loopback or link-local address/);
    });

    it('stops a recording larger than 50 MB', async () => {
      const big: RecordingGet = jest.fn(async () => ({ status: 200, body: Readable.from([Buffer.alloc(MAX_RECORDING_BYTES), Buffer.alloc(1)]) }));
      await expect(new HttpRecordingDownloader(env, big).download('https://recordings.vendor.example/a.mp3')).rejects.toThrow(/larger than 50 MB/);
    });
  });

  it('a queued copy of a refused address is not retried', async () => {
    const prisma = { callRecord: { findUnique: jest.fn(async () => ({ recordingStoragePath: null })), update: jest.fn() } };
    const storage = { put: jest.fn(), signedUrl: jest.fn(), delete: jest.fn() };
    const job = new RecordingCopyJob(prisma as never, storage, new HttpRecordingDownloader(env, jest.fn()));
    await expect(job.handle({ data: { callRecordId: 'c1', recordingUrl: 'https://169.254.169.254/x' } } as never)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
