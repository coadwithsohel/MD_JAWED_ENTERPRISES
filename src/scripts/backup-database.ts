/**
 * DATABASE BACKUP SCRIPT
 *
 * Creates a pg_dump backup of the database before any corrections.
 * Usage:
 *   npx tsx src/scripts/backup-database.ts
 *
 * Requires pg_dump to be installed and DATABASE_URL to be set in .env.
 * The backup file is saved to: web/backups/backup-YYYY-MM-DD-HHmmss.sql
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

function getTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}${min}${s}`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found in environment. Ensure .env is loaded.');
    process.exit(1);
  }

  // Create backups directory
  const backupDir = path.resolve(__dirname, '../../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = getTimestamp();
  const backupFile = path.join(backupDir, `backup-${timestamp}.sql`);

  console.log('══════════════════════════════════════════════════════════');
  console.log('  DATABASE BACKUP');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Backup file: ${backupFile}`);
  console.log(`  Timestamp:   ${timestamp}`);
  console.log('────────────────────────────────────────────────────────────');

  try {
    // Parse DATABASE_URL for pg_dump
    // pg_dump expects: postgresql://user:password@host:port/database
    const url = new URL(databaseUrl);

    // Build pg_dump command
    const pgDumpPath = process.platform === 'win32' ? 'pg_dump' : 'pg_dump';
    const cmd = [
      `set PGPASSWORD=${url.password}`,
      `${pgDumpPath}`,
      `-h ${url.hostname}`,
      `-p ${url.port || '5432'}`,
      `-U ${url.username}`,
      `-d ${url.pathname.slice(1)}`,
      `-F c`, // custom format
      `-f "${backupFile}"`,
      `--no-owner`,
      `--no-acl`,
    ].join(' ');

    console.log('  Running pg_dump...');
    execSync(cmd, { stdio: 'inherit', shell: true as any });
    console.log(`\n  ✅ Backup created successfully: ${backupFile}`);

    const stats = fs.statSync(backupFile);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`  Backup size: ${sizeMB} MB`);
    console.log('────────────────────────────────────────────────────────────');
    console.log('  To restore:');
    console.log(`  pg_restore -d <database_url> "${backupFile}"`);
    console.log('────────────────────────────────────────────────────────────\n');

  } catch (err) {
    console.error('\n❌ Backup failed:', err instanceof Error ? err.message : String(err));
    console.log('\n  Alternative: Use Prisma to export data:');
    console.log('  npx prisma db push --force-reset  # WARNING: destructive');
    console.log('  Or use the Neon console to create a backup.\n');
    process.exit(1);
  }
}

main();