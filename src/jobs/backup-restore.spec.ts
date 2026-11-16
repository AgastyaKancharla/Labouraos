import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

describe('Phase 8 Task 7: Database Backup and Disaster Recovery Procedure', () => {
  const scratchDbName = `laboura_test_restore_${Date.now()}`;
  let backupFile = '';
  let checksumFile = '';
  // INF-11: no default password and always encrypted: both come from the environment.
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';
  const scriptEnv = {
    ...process.env,
    DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
    BACKUP_ENCRYPTION_KEY: 'ci-backup-encryption-key-for-tests-only-0123456789',
  };
  const without = (key: string) => Object.fromEntries(Object.entries(scriptEnv).filter(([k]) => k !== key));

  afterAll(() => {
    // 1. Clean up scratch database in docker postgres
    try {
      execSync(
        `docker exec -i laboura-postgres psql -U postgres -c "DROP DATABASE IF EXISTS ${scratchDbName};"`,
        { stdio: 'ignore' },
      );
    } catch {
      // Ignore cleanup error
    }
    for (const db of [scratchDbName, `${scratchDbName}_wrongkey`]) {
      try {
        execSync(`psql -h ${dbHost} -p ${dbPort} -U postgres -c "DROP DATABASE IF EXISTS ${db};"`, { stdio: 'ignore', env: { ...process.env, PGPASSWORD: scriptEnv.DB_PASSWORD } });
      } catch {
        // Ignore cleanup error
      }
    }

    // 2. Remove test backup artifact
    if (backupFile && fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
    if (checksumFile && fs.existsSync(checksumFile)) {
      fs.unlinkSync(checksumFile);
    }
  });

  it('0. Refuses to run without an encryption key or a database password (INF-11)', () => {
    expect(() => execSync('./scripts/backup.sh', { encoding: 'utf-8', env: without('BACKUP_ENCRYPTION_KEY'), stdio: 'pipe' })).toThrow(/BACKUP_ENCRYPTION_KEY/);
    expect(() => execSync('./scripts/backup.sh', { encoding: 'utf-8', env: { ...scriptEnv, BACKUP_ENCRYPTION_KEY: 'short' }, stdio: 'pipe' })).toThrow(/at least 32 characters/);
    expect(() => execSync('./scripts/backup.sh', { encoding: 'utf-8', env: without('DB_PASSWORD'), stdio: 'pipe' })).toThrow(/DB_PASSWORD/);
    const ignored = fs.readFileSync('.gitignore', 'utf8');
    expect(ignored).toMatch(/^backups\/$/m);
  });

  it('1. Executes automated backup script and generates valid, checksummed archive', () => {
    const backupOutput = execSync('./scripts/backup.sh', {
      encoding: 'utf-8',
      env: scriptEnv,
    });

    expect(backupOutput).toContain('=== [Laboura Backup] SUCCESS ===');
    expect(backupOutput).toContain('SHA-256');

    // Extract backup path from output
    const match = backupOutput.match(/Backup File\s*:\s*(.+)/);
    expect(match).toBeTruthy();
    backupFile = match ? match[1].trim() : '';
    checksumFile = `${backupFile}.sha256`;

    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.existsSync(checksumFile)).toBe(true);

    const fileSize = fs.statSync(backupFile).size;
    expect(fileSize).toBeGreaterThan(1024); // greater than 1KB
    // Encrypted: an openssl "Salted__" file, neither gzip nor SQL text on disk.
    expect(backupFile).toMatch(/\.sql\.gz\.enc$/);
    const head = fs.readFileSync(backupFile).subarray(0, 8);
    expect(head.toString('latin1')).toBe('Salted__');
    expect(fs.readFileSync(backupFile).includes(Buffer.from('CREATE TABLE'))).toBe(false);
  });

  it('2. Restores backup into a scratch database and passes full sanity check', () => {
    expect(backupFile).toBeTruthy();

    // L5: an encrypted backup without its checksum file is refused.
    const lonely = `${backupFile.replace(/\.sql\.gz\.enc$/, '')}-copy.sql.gz.enc`;
    fs.copyFileSync(backupFile, lonely);
    try {
      expect(() => execSync(`./scripts/restore.sh "${lonely}" "${scratchDbName}_nochecksum"`, { encoding: 'utf-8', stdio: 'pipe', env: scriptEnv })).toThrow(/checksum/);
    } finally {
      fs.unlinkSync(lonely);
    }
    // The wrong key restores nothing.
    expect(() => execSync(`./scripts/restore.sh "${backupFile}" "${scratchDbName}_wrongkey"`, {
      encoding: 'utf-8', stdio: 'pipe', env: { ...scriptEnv, BACKUP_ENCRYPTION_KEY: 'a-different-key-that-is-at-least-32-chars-long' },
    })).toThrow();
    const restoreOutput = execSync(
      `./scripts/restore.sh "${backupFile}" "${scratchDbName}"`,
      { encoding: 'utf-8', env: scriptEnv },
    );

    expect(restoreOutput).toContain('=== [Laboura Restore] SUCCESS ===');
    expect(restoreOutput).toContain(`Target DB : ${scratchDbName}`);
    expect(restoreOutput).toContain('Checksum verified');

    // Verify record counts via scratch database Prisma client
    const scratchDbUrl = `postgresql://postgres:postgres@${dbHost}:${dbPort}/${scratchDbName}?schema=public`;
    const scratchPrisma = new PrismaClient({
      datasources: { db: { url: scratchDbUrl } },
    });

    const activePrisma = new PrismaClient();

    return Promise.all([
      scratchPrisma.staff.count(),
      activePrisma.staff.count(),
      scratchPrisma.jobSeeker.count(),
      activePrisma.jobSeeker.count(),
      scratchPrisma.business.count(),
      activePrisma.business.count(),
    ])
      .then(
        ([
          restoredStaff,
          activeStaff,
          restoredJs,
          activeJs,
          restoredBiz,
          activeBiz,
        ]) => {
          expect(restoredStaff).toBe(activeStaff);
          expect(restoredJs).toBe(activeJs);
          expect(restoredBiz).toBe(activeBiz);
        },
      )
      .finally(async () => {
        await scratchPrisma.$disconnect();
        await activePrisma.$disconnect();
      });
  });
});
