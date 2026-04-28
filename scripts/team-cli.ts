#!/usr/bin/env npx tsx
/**
 * Team management CLI
 * Usage:
 *   npx tsx scripts/team-cli.ts create <name>     - Create a new team
 *   npx tsx scripts/team-cli.ts list              - List all teams
 *   npx tsx scripts/team-cli.ts delete <id>       - Delete a team
 *   npx tsx scripts/team-cli.ts add-member <team_id> <name> - Add member to team
 *   npx tsx scripts/team-cli.ts info <team_id>    - Show team info
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'standup.db');

const db = new Database(dbPath);

// Ensure teams table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

const command = process.argv[2];

function generateTeamId(): string {
  // Generate a readable team ID (8 chars, alphanumeric)
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createTeam(name: string) {
  const id = generateTeamId();
  db.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').run(id, name);
  
  console.log(`\n✅ Team created successfully!\n`);
  console.log(`   Name: ${name}`);
  console.log(`   ID:   ${id}`);
  console.log(`\n📎 URLs:`);
  console.log(`   Main:    http://localhost:3001/${id}`);
  console.log(`   Control: http://localhost:3001/${id}/control`);
  console.log(`   Trends:  http://localhost:3001/${id}/trends`);
  console.log(`\n⚠️  Keep the team ID secret - it acts as an access token!\n`);
}

function listTeams() {
  const teams = db.prepare(`
    SELECT t.id, t.name, t.created_at,
           (SELECT COUNT(*) FROM team_members WHERE team_id = t.id AND is_guest = 0) as member_count,
           (SELECT COUNT(*) FROM standups WHERE team_id = t.id) as standup_count
    FROM teams t
    ORDER BY t.created_at DESC
  `).all() as Array<{ id: string; name: string; created_at: number; member_count: number; standup_count: number }>;

  if (teams.length === 0) {
    console.log('\nNo teams found. Create one with: npm run team create <name>\n');
    return;
  }

  console.log(`\n📋 Teams (${teams.length}):\n`);
  for (const team of teams) {
    const date = new Date(team.created_at * 1000).toLocaleDateString();
    console.log(`   ${team.id}  ${team.name.padEnd(20)} ${team.member_count} members, ${team.standup_count} standups (created ${date})`);
  }
  console.log('');
}

function deleteTeam(id: string) {
  const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(id) as { name: string } | undefined;
  if (!team) {
    console.error(`\n❌ Team not found: ${id}\n`);
    process.exit(1);
  }

  // Delete all related data
  db.prepare('DELETE FROM sessions WHERE team_id = ?').run(id);
  db.prepare('DELETE FROM standups WHERE team_id = ?').run(id);
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
  db.prepare('DELETE FROM teams WHERE id = ?').run(id);

  console.log(`\n✅ Deleted team "${team.name}" and all its data\n`);
}

function addMember(teamId: string, name: string) {
  const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId) as { name: string } | undefined;
  if (!team) {
    console.error(`\n❌ Team not found: ${teamId}\n`);
    process.exit(1);
  }

  const memberId = crypto.randomUUID();
  db.prepare('INSERT INTO team_members (id, name, team_id, is_guest) VALUES (?, ?, ?, 0)').run(memberId, name, teamId);
  console.log(`\n✅ Added "${name}" to team "${team.name}"\n`);
}

function showTeamInfo(id: string) {
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as { id: string; name: string; created_at: number } | undefined;
  if (!team) {
    console.error(`\n❌ Team not found: ${id}\n`);
    process.exit(1);
  }

  const members = db.prepare('SELECT name, is_guest FROM team_members WHERE team_id = ? ORDER BY created_at').all(id) as Array<{ name: string; is_guest: number }>;
  const standupCount = (db.prepare('SELECT COUNT(*) as count FROM standups WHERE team_id = ?').get(id) as { count: number }).count;

  console.log(`\n📋 Team: ${team.name}`);
  console.log(`   ID: ${team.id}`);
  console.log(`   Created: ${new Date(team.created_at * 1000).toLocaleString()}`);
  console.log(`   Standups: ${standupCount}`);
  console.log(`\n👥 Members (${members.filter(m => !m.is_guest).length}):`);
  for (const m of members.filter(m => !m.is_guest)) {
    console.log(`   - ${m.name}`);
  }
  console.log('');
}

function migrateOrphanedData(teamId: string) {
  const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId) as { name: string } | undefined;
  if (!team) {
    console.error(`\n❌ Team not found: ${teamId}\n`);
    process.exit(1);
  }

  // Count orphaned records
  const orphanedMembers = (db.prepare('SELECT COUNT(*) as count FROM team_members WHERE team_id IS NULL').get() as { count: number }).count;
  const orphanedSessions = (db.prepare('SELECT COUNT(*) as count FROM sessions WHERE team_id IS NULL').get() as { count: number }).count;
  const orphanedStandups = (db.prepare('SELECT COUNT(*) as count FROM standups WHERE team_id IS NULL').get() as { count: number }).count;

  if (orphanedMembers === 0 && orphanedSessions === 0 && orphanedStandups === 0) {
    console.log('\n✅ No orphaned data to migrate\n');
    return;
  }

  console.log(`\n📦 Migrating orphaned data to team "${team.name}"...`);
  console.log(`   Members:  ${orphanedMembers}`);
  console.log(`   Sessions: ${orphanedSessions}`);
  console.log(`   Standups: ${orphanedStandups}`);

  // Migrate data
  db.prepare('UPDATE team_members SET team_id = ? WHERE team_id IS NULL').run(teamId);
  db.prepare('UPDATE sessions SET team_id = ? WHERE team_id IS NULL').run(teamId);
  db.prepare('UPDATE standups SET team_id = ? WHERE team_id IS NULL').run(teamId);

  console.log(`\n✅ Migration complete!\n`);
}

// Command router
switch (command) {
  case 'create':
    const name = process.argv[3];
    if (!name) {
      console.error('Usage: team create <name>');
      process.exit(1);
    }
    createTeam(name);
    break;
  case 'list':
    listTeams();
    break;
  case 'delete':
    const deleteId = process.argv[3];
    if (!deleteId) {
      console.error('Usage: team delete <id>');
      process.exit(1);
    }
    deleteTeam(deleteId);
    break;
  case 'add-member':
    const teamId = process.argv[3];
    const memberName = process.argv[4];
    if (!teamId || !memberName) {
      console.error('Usage: team add-member <team_id> <name>');
      process.exit(1);
    }
    addMember(teamId, memberName);
    break;
  case 'info':
    const infoId = process.argv[3];
    if (!infoId) {
      console.error('Usage: team info <id>');
      process.exit(1);
    }
    showTeamInfo(infoId);
    break;
  case 'migrate':
    const migrateTeamId = process.argv[3];
    if (!migrateTeamId) {
      console.error('Usage: team migrate <team_id>');
      process.exit(1);
    }
    migrateOrphanedData(migrateTeamId);
    break;
  default:
    console.log(`
Team Management CLI

Commands:
  create <name>                Create a new team
  list                         List all teams
  delete <id>                  Delete a team and all its data
  add-member <team_id> <name>  Add a member to a team
  info <team_id>               Show team details
  migrate <team_id>            Migrate orphaned data to a team

Examples:
  npm run team create "Engineering"
  npm run team list
  npm run team add-member abc123 "Alice"
  npm run team migrate abc123      # Migrate existing data to team
  npm run team delete abc123
`);
}
