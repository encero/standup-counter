#!/usr/bin/env npx tsx
/**
 * Seed the database with fake standup data for the past month.
 * Usage: npx tsx scripts/seed-fake-data.ts <team_id>
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'standup.db');

const teamId = process.argv[2];
if (!teamId) {
  console.error('Usage: npm run seed <team_id>');
  console.error('Example: npm run seed abc123');
  process.exit(1);
}

console.log(`📊 Seeding fake data for team ${teamId} into: ${dbPath}`);

const db = new Database(dbPath);

// Verify team exists
const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId) as { id: string; name: string } | undefined;
if (!team) {
  console.error(`❌ Team not found: ${teamId}`);
  console.error('Create a team first with: npm run team create "Team Name"');
  process.exit(1);
}
console.log(`📍 Team: ${team.name}`);

// Fake team members (will use existing or create new)
const TEAM_MEMBERS = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];

// Ensure team members exist for this team
const existingMembers = db.prepare('SELECT id, name FROM team_members WHERE team_id = ? AND is_guest = 0').all(teamId) as Array<{ id: string; name: string }>;
const memberMap = new Map(existingMembers.map(m => [m.name, m.id]));

for (const name of TEAM_MEMBERS) {
  if (!memberMap.has(name)) {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO team_members (id, name, is_guest, team_id) VALUES (?, ?, 0, ?)').run(id, name, teamId);
    memberMap.set(name, id);
    console.log(`  Created member: ${name}`);
  }
}

// Generate standups for the past 30 weekdays
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const standups: Array<{
  id: string;
  date: Date;
  sessions: Array<{ memberId: string; memberName: string; duration: number; interruptions: number }>;
}> = [];

let currentDate = new Date(now - 35 * DAY_MS); // Start 35 days ago
while (currentDate.getTime() < now) {
  const dayOfWeek = currentDate.getDay();
  
  // Only weekdays (Mon-Fri)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    // Random attendance (3-5 people)
    const attendeeCount = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...TEAM_MEMBERS].sort(() => Math.random() - 0.5);
    const attendees = shuffled.slice(0, attendeeCount);
    
    // Base duration varies by day (Mondays longer, Fridays shorter)
    const dayMultiplier = dayOfWeek === 1 ? 1.3 : dayOfWeek === 5 ? 0.8 : 1.0;
    
    const sessions = attendees.map(name => {
      // Random duration between 30-120 seconds, adjusted by day
      const baseDuration = 30000 + Math.random() * 90000;
      const duration = Math.round(baseDuration * dayMultiplier);
      const interruptions = Math.random() > 0.7 ? Math.floor(Math.random() * 3) : 0;
      
      return {
        memberId: memberMap.get(name)!,
        memberName: name,
        duration,
        interruptions,
      };
    });
    
    standups.push({
      id: crypto.randomUUID(),
      date: new Date(currentDate),
      sessions,
    });
  }
  
  currentDate = new Date(currentDate.getTime() + DAY_MS);
}

console.log(`\n📅 Generating ${standups.length} standups...`);

// Insert sessions and standups
const insertSession = db.prepare(`
  INSERT INTO sessions (id, member_id, member_name, standup_id, start_time, end_time, duration, interruptions, paused_duration, team_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
`);

const insertStandup = db.prepare(`
  INSERT OR REPLACE INTO standups (id, date, day_of_week, start_time, end_time, total_duration, speaker_count, total_interruptions, team_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const standup of standups) {
  // Standup starts at 9:30 AM on that day
  const standupStart = new Date(standup.date);
  standupStart.setHours(9, 30, 0, 0);
  
  let currentTime = standupStart.getTime();
  let totalDuration = 0;
  let totalInterruptions = 0;
  
  for (const session of standup.sessions) {
    const startTime = currentTime;
    const endTime = startTime + session.duration;

    insertSession.run(
      crypto.randomUUID(),
      session.memberId,
      session.memberName,
      standup.id,
      startTime,
      endTime,
      session.duration,
      session.interruptions,
      teamId
    );

    totalDuration += session.duration;
    totalInterruptions += session.interruptions;
    currentTime = endTime + 2000; // 2 second gap between speakers
  }

  const dateStr = standup.date.toISOString().split('T')[0];
  insertStandup.run(
    standup.id,
    dateStr,
    standup.date.getDay(),
    standupStart.getTime(),
    currentTime,
    totalDuration,
    standup.sessions.length,
    totalInterruptions,
    teamId
  );
}

console.log(`✅ Created ${standups.length} standups with ${standups.reduce((sum, s) => sum + s.sessions.length, 0)} sessions`);
console.log('\nSample data by day of week:');

const dayStats = db.prepare(`
  SELECT day_of_week, COUNT(*) as count, AVG(total_duration) as avg_duration
  FROM standups
  WHERE team_id = ?
  GROUP BY day_of_week
  ORDER BY day_of_week
`).all(teamId) as Array<{ day_of_week: number; count: number; avg_duration: number }>;

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
for (const stat of dayStats) {
  const avgSec = Math.round(stat.avg_duration / 1000);
  console.log(`  ${dayNames[stat.day_of_week]}: ${stat.count} standups, avg ${Math.floor(avgSec / 60)}:${(avgSec % 60).toString().padStart(2, '0')}`);
}
