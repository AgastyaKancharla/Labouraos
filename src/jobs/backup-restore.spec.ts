import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

describe('Phase 8 Task 7: Database Backup and Disaster Recovery Procedure', () => {
  const scratchDbName = `laboura_test_restore_${Date.now()}`;
  let backupFile = '';
  let checksumFile = '';

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

    // 2. Remove test backup artifact
    if (backupFile && fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
    if (checksumFile && fs.existsSync(checksumFile)) {
      fs.unlinkSync(checksumFile);
    }
  });

  it('1. Executes automated backup script and generates valid, checksummed archive', () => {
    const backupOutput = execSync('./scripts/backup.sh', {
      encoding: 'utf-8',
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
  });

  it('2. Restores backup into a scratch database and passes full sanity check', () => {
    expect(backupFile).toBeTruthy();

    const restoreOutput = execSync(
      `./scripts/restore.sh "${backupFile}" "${scratchDbName}"`,
      { encoding: 'utf-8' },
    );

    expect(restoreOutput).toContain('=== [Laboura Restore] SUCCESS ===');
    expect(restoreOutput).toContain(`Target DB : ${scratchDbName}`);
    expect(restoreOutput).toContain('Checksum verified');

    // Verify record counts via scratch database Prisma client
    const scratchDbUrl = `postgresql://postgres:postgres@localhost:5432/${scratchDbName}?schema=public`;
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
