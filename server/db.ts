import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine database path
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'standup.db');

const db = new Database(dbPath);

// Migration system
function runMigrations() {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER DEFAULT (unixepoch())
    );
  `);

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(m => m.name)
  );

  // Migration 001: Add standup_id to sessions (if missing)
  if (!appliedMigrations.has('001_add_standup_id')) {
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    const hasStandupId = columns.some(c => c.name === 'standup_id');

    if (!hasStandupId) {
      console.log('📦 Running migration 001: Adding standup_id to sessions...');
      db.exec(`ALTER TABLE sessions ADD COLUMN standup_id TEXT NOT NULL DEFAULT ''`);
    }
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('001_add_standup_id');
  }

  // Migration 002: Create standups table and indexes
  if (!appliedMigrations.has('002_create_standups_table')) {
    console.log('📦 Running migration 002: Creating standups table...');

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

      CREATE INDEX IF NOT EXISTS idx_sessions_standup_id ON sessions(standup_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
      CREATE INDEX IF NOT EXISTS idx_standups_date ON standups(date);
      CREATE INDEX IF NOT EXISTS idx_standups_day_of_week ON standups(day_of_week);
    `);

    // Backfill standups from existing sessions
    const standupAggregates = db.prepare(`
      SELECT
        standup_id,
        MIN(start_time) as start_time,
        MAX(end_time) as end_time,
        SUM(duration) as total_duration,
        COUNT(DISTINCT member_id) as speaker_count,
        SUM(interruptions) as total_interruptions
      FROM sessions
      WHERE standup_id != ''
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
      INSERT OR IGNORE INTO standups (id, date, day_of_week, start_time, end_time, total_duration, speaker_count, total_interruptions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const standup of standupAggregates) {
      const date = new Date(standup.start_time);
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();
      insertStandup.run(
        standup.standup_id, dateStr, dayOfWeek, standup.start_time,
        standup.end_time, standup.total_duration, standup.speaker_count, standup.total_interruptions
      );
    }

    if (standupAggregates.length > 0) {
      console.log(`   ✅ Backfilled ${standupAggregates.length} standups`);
    }

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('002_create_standups_table');
  }

  // Migration 003: Add teams support
  if (!appliedMigrations.has('003_add_teams')) {
    console.log('📦 Running migration 003: Adding teams support...');

    // Create teams table
    db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );
    `);

    // Add team_id to existing tables
    const addTeamIdIfMissing = (table: string) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(c => c.name === 'team_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN team_id TEXT`);
      }
    };

    addTeamIdIfMissing('team_members');
    addTeamIdIfMissing('sessions');
    addTeamIdIfMissing('standups');

    // Create indexes for team_id
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_team_id ON sessions(team_id);
      CREATE INDEX IF NOT EXISTS idx_standups_team_id ON standups(team_id);
    `);

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('003_add_teams');
  }

  // Migration 004: Add stock_symbols to teams
  if (!appliedMigrations.has('004_add_stock_symbols')) {
    console.log('📦 Running migration 004: Adding stock symbols to teams...');

    const columns = db.prepare("PRAGMA table_info(teams)").all() as { name: string }[];
    if (!columns.some(c => c.name === 'stock_symbols')) {
      db.exec(`ALTER TABLE teams ADD COLUMN stock_symbols TEXT DEFAULT ''`);
    }

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('004_add_stock_symbols');
  }

  // Migration 005: Add expected_seconds to teams
  if (!appliedMigrations.has('005_add_expected_seconds')) {
    console.log('📦 Running migration 005: Adding expected_seconds to teams...');

    const columns = db.prepare("PRAGMA table_info(teams)").all() as { name: string }[];
    if (!columns.some(c => c.name === 'expected_seconds')) {
      db.exec(`ALTER TABLE teams ADD COLUMN expected_seconds INTEGER DEFAULT 90`);
    }

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('005_add_expected_seconds');
  }

  // Migration 006: Add sync_notes table (post-standup "sync"/parking-lot items)
  if (!appliedMigrations.has('006_add_sync_notes')) {
    console.log('📦 Running migration 006: Adding sync_notes table...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_notes (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        standup_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sync_notes_team_id ON sync_notes(team_id);
      CREATE INDEX IF NOT EXISTS idx_sync_notes_standup_id ON sync_notes(standup_id);
    `);

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('006_add_sync_notes');
  }

  // Migration 007: Add sprint goal tracking to teams
  if (!appliedMigrations.has('007_add_sprint_goal')) {
    console.log('📦 Running migration 007: Adding sprint goal tracking to teams...');

    const columns = db.prepare("PRAGMA table_info(teams)").all() as { name: string }[];
    const addColumnIfMissing = (name: string, def: string) => {
      if (!columns.some(c => c.name === name)) {
        db.exec(`ALTER TABLE teams ADD COLUMN ${name} ${def}`);
      }
    };

    // sprint_start: ISO date (YYYY-MM-DD) of a reference sprint start; the current
    // sprint window is derived by repeating sprint_length_days from this anchor.
    addColumnIfMissing('sprint_start', "TEXT DEFAULT ''");
    addColumnIfMissing('sprint_length_days', 'INTEGER DEFAULT 14');
    addColumnIfMissing('sprint_goal', "TEXT DEFAULT ''");
    // Unix ms timestamp the goal was last marked done; compared against the current
    // sprint window so "done" auto-resets each new sprint without a scheduled job.
    addColumnIfMissing('sprint_goal_done_at', 'INTEGER');
    // Comma-separated descending day counts at which urgency escalates as the sprint
    // end nears: notice, warning, critical (each triggers when days-remaining <= it).
    addColumnIfMissing('sprint_thresholds', "TEXT DEFAULT '7,3,1'");

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('007_add_sprint_goal');
  }

  // Migration 008: Add PR review queue (pushed in by the local publisher CLI)
  if (!appliedMigrations.has('008_add_pr_status')) {
    console.log('📦 Running migration 008: Adding PR review queue...');

    // Per-team bearer token (stored as a SHA-256 hash, never plaintext) that the
    // publisher CLI presents when pushing PR data. Generated via `npm run team pr-token`.
    const columns = db.prepare("PRAGMA table_info(teams)").all() as { name: string }[];
    if (!columns.some(c => c.name === 'pr_ingest_token_hash')) {
      db.exec(`ALTER TABLE teams ADD COLUMN pr_ingest_token_hash TEXT`);
    }

    // Latest snapshot of PRs needing review, one row per team. payload is the
    // JSON array of {author,title,repo,number}; updated_at is the bulk sync time.
    db.exec(`
      CREATE TABLE IF NOT EXISTS pr_status (
        team_id    TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('008_add_pr_status');
  }

  // Migration 009: Per-window sprint goals, bound to the window they belong to.
  // The old model kept a single sticky sprint_goal on the team that never rolled,
  // so an ended sprint's goal leaked into the next window. Now each goal lives in
  // its own row keyed by the window START DATE; when the sprint rolls the current
  // window has no row and the banner prompts for a fresh goal, while past goals
  // stay archived. done_at moves onto the row too, so completion is per-window.
  if (!appliedMigrations.has('009_sprint_goal_windows')) {
    console.log('📦 Running migration 009: Per-window sprint goals...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sprint_goals (
        team_id     TEXT NOT NULL,
        start_date  TEXT NOT NULL,   -- YYYY-MM-DD window start; the binding key
        goal        TEXT NOT NULL,
        length_days INTEGER NOT NULL,
        set_at      INTEGER NOT NULL,
        done_at     INTEGER,
        PRIMARY KEY (team_id, start_date)
      );

      CREATE INDEX IF NOT EXISTS idx_sprint_goals_team ON sprint_goals(team_id);
    `);

    // Backfill: bind each team's existing goal to its CURRENT window so nothing is
    // lost. It then expires naturally on the next rollover. Window math mirrors the
    // server's: map local calendar dates to UTC-midnight so whole-day counting is
    // DST-safe.
    const DAY = 86_400_000;
    const now = Date.now();
    const nd = new Date(now);
    const todayUTC = Date.UTC(nd.getFullYear(), nd.getMonth(), nd.getDate());

    const teams = db.prepare(
      "SELECT id, sprint_start, sprint_length_days, sprint_goal, sprint_goal_done_at FROM teams WHERE sprint_goal IS NOT NULL AND sprint_goal != ''"
    ).all() as Array<{ id: string; sprint_start: string | null; sprint_length_days: number | null; sprint_goal: string; sprint_goal_done_at: number | null }>;

    const insert = db.prepare(
      'INSERT OR IGNORE INTO sprint_goals (team_id, start_date, goal, length_days, set_at, done_at) VALUES (?, ?, ?, ?, ?, ?)'
    );

    for (const t of teams) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.sprint_start || '');
      if (!m) continue;
      const len = Number.isFinite(t.sprint_length_days) && (t.sprint_length_days as number) >= 1 ? (t.sprint_length_days as number) : 14;
      const anchorUTC = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const daysSince = Math.floor((todayUTC - anchorUTC) / DAY);
      const index = Math.max(0, Math.floor(daysSince / len));
      const startYMD = new Date(anchorUTC + index * len * DAY).toISOString().slice(0, 10);
      // Preserve completion: if the current goal was marked done, keep it done for
      // this window (it's the window it was completed in).
      insert.run(t.id, startYMD, t.sprint_goal, len, now, t.sprint_goal_done_at ?? null);
    }

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run('009_sprint_goal_windows');
  }

  console.log('✅ Database migrations complete');
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT,
    is_guest INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    member_name TEXT NOT NULL,
    standup_id TEXT NOT NULL DEFAULT '',
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration INTEGER NOT NULL,
    interruptions INTEGER DEFAULT 0,
    paused_duration INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (member_id) REFERENCES team_members(id)
  );
`);

// Run migrations
runMigrations();

export default db;
