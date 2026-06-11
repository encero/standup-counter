/**
 * Test helpers for behavior tests
 * Provides utilities for test database setup, server management, and API calls
 */
import { ChildProcess, spawn } from 'child_process';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test database path
export const TEST_DB_PATH = path.join(__dirname, '..', 'test-standup.db');
export const BASE_URL = 'http://localhost:3001';

let serverProcess: ChildProcess | null = null;

/**
 * Generate a random team ID (8 chars, alphanumeric)
 */
export function generateTeamId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Create and initialize a fresh test database
 */
export function createTestDatabase(): Database.Database {
  // Remove existing test database
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  } catch {
    // Ignore if file doesn't exist
  }

  const db = new Database(TEST_DB_PATH);

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stock_symbols TEXT DEFAULT '',
      expected_seconds INTEGER DEFAULT 90,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      is_guest INTEGER DEFAULT 0,
      team_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      team_id TEXT,
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

    CREATE TABLE IF NOT EXISTS standups (
      id TEXT PRIMARY KEY,
      team_id TEXT,
      date TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      total_duration INTEGER NOT NULL DEFAULT 0,
      speaker_count INTEGER NOT NULL DEFAULT 0,
      total_interruptions INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_team_id ON sessions(team_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_standup_id ON sessions(standup_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
    CREATE INDEX IF NOT EXISTS idx_standups_team_id ON standups(team_id);
    CREATE INDEX IF NOT EXISTS idx_standups_date ON standups(date);
    CREATE INDEX IF NOT EXISTS idx_standups_day_of_week ON standups(day_of_week);
  `);

  // Mark migrations as complete
  db.prepare("INSERT OR IGNORE INTO _migrations (name) VALUES (?)").run('001_add_standup_id');
  db.prepare("INSERT OR IGNORE INTO _migrations (name) VALUES (?)").run('002_create_standups_table');
  db.prepare("INSERT OR IGNORE INTO _migrations (name) VALUES (?)").run('003_add_teams');
  db.prepare("INSERT OR IGNORE INTO _migrations (name) VALUES (?)").run('004_add_stock_symbols');
  db.prepare("INSERT OR IGNORE INTO _migrations (name) VALUES (?)").run('005_add_expected_seconds');

  return db;
}

/**
 * Create a test team with optional members
 */
export function createTestTeam(db: Database.Database, name: string, members: string[] = []): string {
  const teamId = generateTeamId();
  db.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').run(teamId, name);

  for (const memberName of members) {
    const memberId = crypto.randomUUID();
    db.prepare('INSERT INTO team_members (id, name, team_id, is_guest) VALUES (?, ?, ?, 0)')
      .run(memberId, memberName, teamId);
  }

  return teamId;
}

/**
 * Build the frontend for production
 */
export async function buildFrontend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const projectRoot = path.join(__dirname, '..');

    const buildProcess = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';

    buildProcess.stdout?.on('data', (data) => {
      output += data.toString();
    });

    buildProcess.stderr?.on('data', (data) => {
      output += data.toString();
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}: ${output}`));
      }
    });

    buildProcess.on('error', reject);
  });
}

/**
 * Start the server process for tests
 */
export async function startServer(): Promise<void> {
  if (serverProcess) {
    return; // Already running
  }

  return new Promise((resolve, reject) => {
    const projectRoot = path.join(__dirname, '..');

    serverProcess = spawn('npx', ['tsx', 'server/index.ts'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DB_PATH: TEST_DB_PATH,
        PORT: '3001',
        NODE_ENV: 'production', // Use production mode to serve static files
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        reject(new Error('Server failed to start within 10 seconds'));
      }
    }, 10000);

    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Server running')) {
        started = true;
        clearTimeout(timeout);
        // Give it a moment to fully initialize
        setTimeout(resolve, 500);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Stop the server process
 */
export async function stopServer(): Promise<void> {
  if (!serverProcess) {
    return;
  }

  return new Promise((resolve) => {
    serverProcess!.on('exit', () => {
      serverProcess = null;
      resolve();
    });

    serverProcess!.kill('SIGTERM');

    // Force kill after 5 seconds
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
        serverProcess = null;
        resolve();
      }
    }, 5000);
  });
}

/**
 * Wait for server to be ready
 */
export async function waitForServer(maxRetries = 20): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${BASE_URL}/api/server-info`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become ready');
}

/**
 * Clean up test database file
 */
export function cleanupTestDatabase(): void {
  try {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  } catch {
    // Ignore errors
  }
}
