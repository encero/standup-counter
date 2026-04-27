/**
 * Migration 001: Add trends support
 * 
 * This migration:
 * 1. Backs up existing data to JSON
 * 2. Adds indexes for efficient trend queries
 * 3. Creates a standups summary table for cached aggregates
 * 4. Backfills the standups table from existing sessions
 * 
 * Run with: npx tsx server/migrations/001_add_trends_support.ts [--dev-mode]
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check for --dev-mode flag
const isDevMode = process.argv.includes('--dev-mode');
const dbPath = isDevMode 
  ? path.join(__dirname, '..', '..', 'standup-dev.db')
  : path.join(__dirname, '..', '..', 'standup.db');

console.log(`📦 Running migration on: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
  console.log('❌ Database file not found. Nothing to migrate.');
  process.exit(0);
}

const db = new Database(dbPath);

// Step 1: Backup existing data
console.log('\n📁 Step 1: Backing up existing data...');
const backupDir = path.join(__dirname, '..', '..', 'backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, `backup-${timestamp}.json`);

const members = db.prepare('SELECT * FROM team_members').all();
const sessions = db.prepare('SELECT * FROM sessions').all();

fs.writeFileSync(backupFile, JSON.stringify({ members, sessions }, null, 2));
console.log(`   ✅ Backed up ${members.length} members and ${sessions.length} sessions to ${backupFile}`);

// Step 2: Add indexes for trend queries
console.log('\n🔧 Step 2: Adding indexes for trend queries...');

const indexes = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_standup_id ON sessions(standup_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_member_standup ON sessions(member_id, standup_id)',
];

for (const sql of indexes) {
  db.exec(sql);
  console.log(`   ✅ ${sql.split(' ')[5]}`);
}

// Step 3: Create standups summary table
console.log('\n📊 Step 3: Creating standups summary table...');

db.exec(`
  CREATE TABLE IF NOT EXISTS standups (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    total_duration INTEGER NOT NULL DEFAULT 0,
    speaker_count INTEGER NOT NULL DEFAULT 0,
    total_interruptions INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );
  
  CREATE INDEX IF NOT EXISTS idx_standups_date ON standups(date);
  CREATE INDEX IF NOT EXISTS idx_standups_day_of_week ON standups(day_of_week);
`);
console.log('   ✅ Created standups table with indexes');

// Step 4: Backfill standups table from existing sessions
console.log('\n🔄 Step 4: Backfilling standups from existing sessions...');

const standupAggregates = db.prepare(`
  SELECT 
    standup_id,
    MIN(start_time) as start_time,
    MAX(end_time) as end_time,
    SUM(duration) as total_duration,
    COUNT(DISTINCT member_id) as speaker_count,
    SUM(interruptions) as total_interruptions
  FROM sessions
  GROUP BY standup_id
`).all() as Array<{
  standup_id: string;
  start_time: number;
  end_time: number;
  total_duration: number;
  speaker_count: number;
  total_interruptions: number;
}>;

const insertStandup = db.prepare(`
  INSERT OR REPLACE INTO standups (id, date, day_of_week, start_time, end_time, total_duration, speaker_count, total_interruptions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const standup of standupAggregates) {
  const date = new Date(standup.start_time);
  const dateStr = date.toISOString().split('T')[0];
  const dayOfWeek = date.getDay();
  
  insertStandup.run(
    standup.standup_id,
    dateStr,
    dayOfWeek,
    standup.start_time,
    standup.end_time,
    standup.total_duration,
    standup.speaker_count,
    standup.total_interruptions
  );
}

console.log(`   ✅ Backfilled ${standupAggregates.length} standups`);

// Step 5: Verify migration
console.log('\n✅ Migration complete!');
console.log(`   - Members: ${members.length}`);
console.log(`   - Sessions: ${sessions.length}`);
console.log(`   - Standups: ${standupAggregates.length}`);
console.log(`   - Backup: ${backupFile}`);

db.close();
