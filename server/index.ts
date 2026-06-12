import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';
import { networkInterfaces } from 'os';
import { createHash, timingSafeEqual, randomBytes } from 'crypto';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// App version. Baked into the client bundle at build time (see vite.config.ts)
// and read here at runtime from the same env var. When a redeploy changes this,
// connected clients detect the mismatch on reconnect and reload themselves.
const APP_VERSION = process.env.APP_VERSION || 'dev';

// Get local network IP addresses
function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

app.use(cors());
app.use(express.json());

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
}

// Create HTTP server and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Post-standup "sync" / parking-lot note
interface SyncNote {
  id: string;
  text: string;
  standupId: string;
  createdAt: number;
}

// Timer state per team
interface TimerState {
  currentSpeaker: { id: string; name: string; isGuest?: boolean } | null;
  standupId: string | null;
  status: 'idle' | 'running' | 'paused';
  elapsedTime: number;
  interruptions: number;
  startTime: number | null;
  totalPaused: number;
  pauseStart: number | null;
  syncNotes: SyncNote[];
}

const defaultTimerState = (): TimerState => ({
  currentSpeaker: null,
  standupId: null,
  status: 'idle',
  elapsedTime: 0,
  interruptions: 0,
  startTime: null,
  totalPaused: 0,
  pauseStart: null,
  syncNotes: [],
});

const MAX_NOTE_LENGTH = 500;
const MAX_NOTES_PER_STANDUP = 100;

// Per-team timer states
const teamTimerStates = new Map<string, TimerState>();
// Per-team WebSocket clients
const teamClients = new Map<string, Set<WebSocket>>();

function getTeamState(teamId: string): TimerState {
  if (!teamTimerStates.has(teamId)) {
    teamTimerStates.set(teamId, defaultTimerState());
  }
  return teamTimerStates.get(teamId)!;
}

function getTeamClients(teamId: string): Set<WebSocket> {
  if (!teamClients.has(teamId)) {
    teamClients.set(teamId, new Set());
  }
  return teamClients.get(teamId)!;
}

// Broadcast state to all clients in a team
function broadcastToTeam(teamId: string, data: object) {
  const message = JSON.stringify(data);
  const clients = getTeamClients(teamId);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Update elapsed time periodically for all teams
setInterval(() => {
  for (const [teamId, state] of teamTimerStates.entries()) {
    if (state.status === 'running' && state.startTime) {
      state.elapsedTime = Date.now() - state.startTime - state.totalPaused;
      broadcastToTeam(teamId, { type: 'tick', elapsedTime: state.elapsedTime });
    }
  }
}, 100);

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  // Extract team ID from URL path: /ws/<teamId>
  const pathname = parseUrl(req.url || '').pathname || '';
  const match = pathname.match(/^\/ws\/([a-z0-9]+)$/);

  if (!match) {
    console.log('WebSocket rejected: no team ID in path');
    ws.close(4000, 'Team ID required');
    return;
  }

  const teamId = match[1];

  // Verify team exists
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    console.log(`WebSocket rejected: team not found: ${teamId}`);
    ws.close(4001, 'Team not found');
    return;
  }

  console.log(`Client connected to team: ${teamId}`);
  getTeamClients(teamId).add(ws);

  // Announce the server version first so the client can detect a version
  // mismatch (e.g. after a redeploy) and force a reload.
  ws.send(JSON.stringify({ type: 'hello', version: APP_VERSION }));

  // Send current state to new client
  const state = getTeamState(teamId);
  ws.send(JSON.stringify({ type: 'state', ...state }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const timerState = getTeamState(teamId);

      switch (msg.type) {
        case 'start':
          // Reuse a standupId already created by an early sync note; otherwise mint one.
          if (!timerState.standupId) {
            timerState.standupId = crypto.randomUUID();
          }
          timerState.currentSpeaker = msg.speaker;
          timerState.status = 'running';
          timerState.startTime = Date.now();
          timerState.elapsedTime = 0;
          timerState.interruptions = 0;
          timerState.totalPaused = 0;
          timerState.pauseStart = null;
          broadcastToTeam(teamId, { type: 'state', ...timerState });
          break;

        case 'pause':
          if (timerState.status === 'running') {
            timerState.status = 'paused';
            timerState.pauseStart = Date.now();
            timerState.interruptions++;
            broadcastToTeam(teamId, { type: 'state', ...timerState });
          }
          break;

        case 'resume':
          if (timerState.status === 'paused' && timerState.pauseStart) {
            timerState.totalPaused += Date.now() - timerState.pauseStart;
            timerState.pauseStart = null;
            timerState.status = 'running';
            broadcastToTeam(teamId, { type: 'state', ...timerState });
          }
          break;

        case 'stop':
          // Broadcast end_standup with the standupId + any sync notes before resetting
          if (timerState.standupId) {
            broadcastToTeam(teamId, {
              type: 'end_standup',
              standupId: timerState.standupId,
              syncNotes: timerState.syncNotes,
            });
          }
          timerState.currentSpeaker = null;
          timerState.standupId = null;
          timerState.status = 'idle';
          timerState.elapsedTime = 0;
          timerState.interruptions = 0;
          timerState.startTime = null;
          timerState.totalPaused = 0;
          timerState.pauseStart = null;
          timerState.syncNotes = [];
          broadcastToTeam(teamId, { type: 'state', ...timerState });
          break;

        case 'add_note': {
          const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_NOTE_LENGTH) : '';
          if (!text || timerState.syncNotes.length >= MAX_NOTES_PER_STANDUP) break;
          // A note can be jotted before the first speaker — mint a standupId so it has a home.
          if (!timerState.standupId) {
            timerState.standupId = crypto.randomUUID();
          }
          const note: SyncNote = {
            id: crypto.randomUUID(),
            text,
            standupId: timerState.standupId,
            createdAt: Date.now(),
          };
          timerState.syncNotes.push(note);
          db.prepare(
            'INSERT INTO sync_notes (id, team_id, standup_id, text, created_at) VALUES (?, ?, ?, ?, ?)'
          ).run(note.id, teamId, note.standupId, note.text, note.createdAt);
          broadcastToTeam(teamId, {
            type: 'notes',
            standupId: timerState.standupId,
            syncNotes: timerState.syncNotes,
          });
          break;
        }

        case 'remove_note': {
          const noteId = typeof msg.id === 'string' ? msg.id : '';
          if (!noteId) break;
          timerState.syncNotes = timerState.syncNotes.filter(n => n.id !== noteId);
          db.prepare('DELETE FROM sync_notes WHERE id = ? AND team_id = ?').run(noteId, teamId);
          broadcastToTeam(teamId, {
            type: 'notes',
            standupId: timerState.standupId,
            syncNotes: timerState.syncNotes,
          });
          break;
        }

        case 'getState':
          ws.send(JSON.stringify({ type: 'state', ...timerState }));
          break;

        case 'ping':
          // Heartbeat ping - respond immediately with pong
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected from team: ${teamId}`);
    getTeamClients(teamId).delete(ws);
  });
});

// Middleware to validate team ID
interface TeamRequest extends Request {
  teamId: string;
}

function validateTeam(req: Request, res: Response, next: NextFunction) {
  const teamId = req.params.teamId;
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);

  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  (req as TeamRequest).teamId = teamId;
  next();
}

// Helper to update standups aggregate table
function updateStandupAggregate(standupId: string, teamId: string) {
  const aggregate = db.prepare(`
    SELECT
      MIN(start_time) as startTime,
      MAX(end_time) as endTime,
      SUM(duration) as totalDuration,
      COUNT(DISTINCT member_id) as speakerCount,
      SUM(interruptions) as totalInterruptions
    FROM sessions WHERE standup_id = ?
  `).get(standupId) as { startTime: number; endTime: number; totalDuration: number; speakerCount: number; totalInterruptions: number };

  if (aggregate && aggregate.startTime) {
    const date = new Date(aggregate.startTime);
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();

    db.prepare(`
      INSERT OR REPLACE INTO standups (id, team_id, date, day_of_week, start_time, end_time, total_duration, speaker_count, total_interruptions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(standupId, teamId, dateStr, dayOfWeek, aggregate.startTime, aggregate.endTime, aggregate.totalDuration, aggregate.speakerCount, aggregate.totalInterruptions);
  }
}

// --- Sprint goal tracking ---------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;

interface SprintStatus {
  configured: boolean;      // a valid start date + interval is set
  goal: string;             // free-text goal description
  hasGoal: boolean;         // goal text is non-empty
  lengthDays: number;       // sprint interval in calendar days
  startDate: string;        // raw 'YYYY-MM-DD' anchor from config
  sprintStart: number;      // ms — start of the CURRENT sprint window
  sprintEnd: number;        // ms — end of the current window (exclusive)
  elapsedFraction: number;  // 0..1 progress through the current window
  daysRemaining: number;    // whole calendar days left in the window
  done: boolean;            // goal marked done within the current window
  thresholds: SprintThresholds; // days-remaining cutoffs for each urgency level
}

// Day counts at which each urgency level kicks in: a level triggers once the
// sprint has `daysRemaining <= threshold` days left. notice triggers earliest
// (most days left), critical latest, so notice > warning > critical >= 1.
interface SprintThresholds {
  notice: number;   // calm -> notice
  warning: number;  // notice -> warning
  critical: number; // warning -> critical
}

const DEFAULT_THRESHOLDS: SprintThresholds = { notice: 7, warning: 3, critical: 1 };

// Parse "7,3,1" into descending day counts, falling back to defaults on any
// malformed/out-of-order/out-of-range input so the client always gets sane cutoffs.
function parseThresholds(raw: string | null | undefined): SprintThresholds {
  const parts = (raw || '').split(',').map(s => Number(s.trim()));
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 1 || n > 365)) {
    return DEFAULT_THRESHOLDS;
  }
  const [notice, warning, critical] = parts;
  if (!(notice > warning && warning > critical)) return DEFAULT_THRESHOLDS;
  return { notice, warning, critical };
}

// Derive the current sprint window by repeating the interval from the anchor
// date. "done" is stored as a timestamp and only counts for the window it falls
// in, so it auto-resets each new sprint with no scheduled job.
function computeSprintStatus(teamId: string): SprintStatus {
  const team = db.prepare(
    'SELECT sprint_start, sprint_length_days, sprint_goal, sprint_goal_done_at, sprint_thresholds FROM teams WHERE id = ?'
  ).get(teamId) as {
    sprint_start: string | null;
    sprint_length_days: number | null;
    sprint_goal: string | null;
    sprint_goal_done_at: number | null;
    sprint_thresholds: string | null;
  } | undefined;

  const goal = team?.sprint_goal || '';
  const hasGoal = goal.trim().length > 0;
  const startDate = team?.sprint_start || '';
  const rawLength = team?.sprint_length_days;
  const lengthDays = Number.isFinite(rawLength) && (rawLength as number) >= 1 ? (rawLength as number) : 14;
  const doneAt = team?.sprint_goal_done_at ?? null;
  const thresholds = parseThresholds(team?.sprint_thresholds);

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!m) {
    return {
      configured: false, goal, hasGoal, lengthDays, startDate,
      sprintStart: 0, sprintEnd: 0, elapsedFraction: 0, daysRemaining: 0, done: false, thresholds,
    };
  }

  // Local midnight of the anchor date.
  const anchorMs = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const lenMs = lengthDays * DAY_MS;
  const now = Date.now();

  // Clamp to sprint 0 before the anchor so a future start date doesn't go negative.
  const index = Math.max(0, Math.floor((now - anchorMs) / lenMs));
  const sprintStart = anchorMs + index * lenMs;
  const sprintEnd = sprintStart + lenMs;
  const elapsedFraction = Math.min(1, Math.max(0, (now - sprintStart) / lenMs));
  const daysRemaining = Math.max(0, Math.ceil((sprintEnd - now) / DAY_MS));
  const done = doneAt != null && doneAt >= sprintStart && doneAt < sprintEnd;

  return {
    configured: true, goal, hasGoal, lengthDays, startDate,
    sprintStart, sprintEnd, elapsedFraction, daysRemaining, done, thresholds,
  };
}

// Version endpoint (no auth required) - lets the client verify it matches the server
app.get('/api/version', (_req, res) => {
  res.json({ version: APP_VERSION });
});

// Server info endpoint (no auth required)
app.get('/api/server-info', (_req, res) => {
  const ips = getLocalIPs();
  res.json({
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    networkUrls: ips.map(ip => `http://${ip}:${PORT}`),
  });
});

// All API routes require team_id prefix
const teamRouter = express.Router({ mergeParams: true });

// Team Members endpoints
teamRouter.get('/members', (req, res) => {
  const { teamId } = req.params;
  const members = db.prepare(`
    SELECT id, name, avatar, is_guest as isGuest FROM team_members WHERE team_id = ? ORDER BY created_at
  `).all(teamId) as Array<{ id: string; name: string; avatar: string | null; isGuest: number }>;
  res.json(members.map(m => ({ ...m, isGuest: Boolean(m.isGuest) })));
});

teamRouter.post('/members', (req, res) => {
  const { teamId } = req.params;
  const { id, name, isGuest } = req.body;
  db.prepare('INSERT INTO team_members (id, name, team_id, is_guest) VALUES (?, ?, ?, ?)').run(id, name, teamId, isGuest ? 1 : 0);
  res.json({ id, name, isGuest });
});

teamRouter.delete('/members/:id', (req, res) => {
  const { teamId } = req.params;
  db.prepare('DELETE FROM team_members WHERE id = ? AND team_id = ?').run(req.params.id, teamId);
  res.json({ success: true });
});

// Sessions endpoints
teamRouter.get('/sessions', (req, res) => {
  const { teamId } = req.params;
  const sessions = db.prepare(`
    SELECT id, member_id as memberId, member_name as memberName,
           standup_id as standupId, start_time as startTime, end_time as endTime,
           duration, interruptions, paused_duration as pausedDuration
    FROM sessions WHERE team_id = ? ORDER BY created_at DESC
  `).all(teamId);
  res.json(sessions);
});

teamRouter.post('/sessions', (req, res) => {
  const { teamId } = req.params;
  const { id, memberId, memberName, standupId, startTime, endTime, duration, interruptions, pausedDuration } = req.body;
  db.prepare(`
    INSERT INTO sessions (id, team_id, member_id, member_name, standup_id, start_time, end_time, duration, interruptions, paused_duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, teamId, memberId, memberName, standupId, startTime, endTime, duration, interruptions, pausedDuration);

  // Update standup aggregate
  updateStandupAggregate(standupId, teamId);

  res.json({ id, memberId, memberName, standupId, startTime, endTime, duration, interruptions, pausedDuration });
});

teamRouter.put('/sessions/:id', (req, res) => {
  const { teamId } = req.params;
  const { id } = req.params;
  const { standupId, endTime, duration, interruptions, pausedDuration } = req.body;
  db.prepare(`
    UPDATE sessions SET end_time = ?, duration = ?, interruptions = ?, paused_duration = ?
    WHERE id = ? AND team_id = ?
  `).run(endTime, duration, interruptions, pausedDuration, id, teamId);

  // Update standup aggregate
  if (standupId) {
    updateStandupAggregate(standupId, teamId);
  }

  res.json({ success: true });
});

teamRouter.delete('/sessions', (req, res) => {
  const { teamId } = req.params;
  db.prepare('DELETE FROM sessions WHERE team_id = ?').run(teamId);
  db.prepare('DELETE FROM standups WHERE team_id = ?').run(teamId);
  res.json({ success: true });
});

// Sync notes endpoint - persisted parking-lot items for a given standup
teamRouter.get('/notes', (req, res) => {
  const { teamId } = req.params;
  const standupId = req.query.standupId as string | undefined;
  if (!standupId) {
    res.json([]);
    return;
  }
  const notes = db.prepare(`
    SELECT id, text, standup_id as standupId, created_at as createdAt
    FROM sync_notes WHERE team_id = ? AND standup_id = ? ORDER BY created_at ASC
  `).all(teamId, standupId);
  res.json(notes);
});

// Trends endpoints
teamRouter.get('/trends/standups', (req, res) => {
  const { teamId } = req.params;
  const days = parseInt(req.query.days as string) || 30;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const standups = db.prepare(`
    SELECT id, date, day_of_week as dayOfWeek, start_time as startTime,
           total_duration as totalDuration, speaker_count as speakerCount,
           total_interruptions as totalInterruptions
    FROM standups
    WHERE team_id = ? AND start_time > ?
    ORDER BY start_time DESC
  `).all(teamId, since);

  res.json(standups);
});

teamRouter.get('/trends/team', (req, res) => {
  const { teamId } = req.params;
  const days = parseInt(req.query.days as string) || 30;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  // Overall stats
  const overall = db.prepare(`
    SELECT
      COUNT(*) as standupCount,
      AVG(total_duration) as avgDuration,
      AVG(speaker_count) as avgSpeakers,
      SUM(total_interruptions) as totalInterruptions
    FROM standups WHERE team_id = ? AND start_time > ?
  `).get(teamId, since) as { standupCount: number; avgDuration: number; avgSpeakers: number; totalInterruptions: number };

  // Day of week breakdown
  const byDayOfWeek = db.prepare(`
    SELECT
      day_of_week as dayOfWeek,
      COUNT(*) as count,
      AVG(total_duration) as avgDuration
    FROM standups WHERE team_id = ? AND start_time > ?
    GROUP BY day_of_week
    ORDER BY day_of_week
  `).all(teamId, since);

  // Recent trend (last 7 vs previous 7)
  const week = 7 * 24 * 60 * 60 * 1000;
  const lastWeek = db.prepare(`
    SELECT AVG(total_duration) as avg FROM standups WHERE team_id = ? AND start_time > ?
  `).get(teamId, Date.now() - week) as { avg: number };
  const prevWeek = db.prepare(`
    SELECT AVG(total_duration) as avg FROM standups WHERE team_id = ? AND start_time > ? AND start_time <= ?
  `).get(teamId, Date.now() - 2 * week, Date.now() - week) as { avg: number };

  const trend = lastWeek?.avg && prevWeek?.avg
    ? ((lastWeek.avg - prevWeek.avg) / prevWeek.avg) * 100
    : 0;

  // Daily standup durations for the past 30 days
  const dailyStandups = db.prepare(`
    SELECT start_time as date, total_duration as duration
    FROM standups WHERE team_id = ? AND start_time > ?
    ORDER BY start_time ASC
  `).all(teamId, since) as Array<{ date: number; duration: number }>;

  res.json({ overall, byDayOfWeek, trend, dailyStandups });
});

teamRouter.get('/trends/members', (req, res) => {
  const { teamId } = req.params;
  const days = parseInt(req.query.days as string) || 30;
  const now = Date.now();
  const since = now - days * 24 * 60 * 60 * 1000;
  const since7d = now - 7 * 24 * 60 * 60 * 1000;

  // Get aggregate stats for TrendsPage (members array)
  const membersAggregate = db.prepare(`
    SELECT
      member_id as memberId,
      member_name as memberName,
      COUNT(DISTINCT standup_id) as standupCount,
      AVG(duration) as avgDuration,
      SUM(duration) as totalDuration
    FROM sessions WHERE team_id = ? AND start_time > ?
    GROUP BY member_id
  `).all(teamId, since) as Array<{ memberId: string; memberName: string; standupCount: number; avgDuration: number; totalDuration: number }>;

  // Get all team members for memberStats (used in StandupSummary)
  const allMembers = db.prepare('SELECT id, name FROM team_members WHERE team_id = ?').all(teamId) as Array<{ id: string; name: string }>;

  const memberStats: Record<string, { avg7d: number | null; avg30d: number | null }> = {};
  const sparklineData: Record<string, number[]> = {};
  const trends: Record<string, number> = {};

  for (const member of allMembers) {
    // 7-day average (daily totals, then average)
    const sessions7d = db.prepare(`
      SELECT start_time, duration FROM sessions
      WHERE member_id = ? AND team_id = ? AND start_time > ?
    `).all(member.id, teamId, since7d) as Array<{ start_time: number; duration: number }>;

    const daily7d: Record<string, number> = {};
    for (const s of sessions7d) {
      const dayKey = new Date(s.start_time).toDateString();
      daily7d[dayKey] = (daily7d[dayKey] || 0) + s.duration;
    }
    const daily7dValues = Object.values(daily7d);
    memberStats[member.id] = {
      avg7d: daily7dValues.length > 0 ? daily7dValues.reduce((a, b) => a + b, 0) / daily7dValues.length : null,
      avg30d: null,
    };

    // 30-day average (daily totals, then average)
    const sessions30d = db.prepare(`
      SELECT start_time, duration FROM sessions
      WHERE member_id = ? AND team_id = ? AND start_time > ?
    `).all(member.id, teamId, since) as Array<{ start_time: number; duration: number }>;

    const daily30d: Record<string, number> = {};
    for (const s of sessions30d) {
      const dayKey = new Date(s.start_time).toDateString();
      daily30d[dayKey] = (daily30d[dayKey] || 0) + s.duration;
    }
    const daily30dValues = Object.values(daily30d);
    memberStats[member.id].avg30d = daily30dValues.length > 0
      ? daily30dValues.reduce((a, b) => a + b, 0) / daily30dValues.length
      : null;

    // Sparkline data (last 10 sessions)
    const durations = db.prepare(`
      SELECT duration FROM sessions
      WHERE member_id = ? AND team_id = ? AND start_time > ?
      ORDER BY start_time DESC
      LIMIT 10
    `).all(member.id, teamId, since) as Array<{ duration: number }>;
    sparklineData[member.id] = durations.map(d => d.duration).reverse();

    // Calculate trends (last 3 vs previous 3)
    const recent = db.prepare(`
      SELECT AVG(duration) as avg FROM (
        SELECT duration FROM sessions WHERE member_id = ? AND team_id = ? ORDER BY start_time DESC LIMIT 3
      )
    `).get(member.id, teamId) as { avg: number };
    const previous = db.prepare(`
      SELECT AVG(duration) as avg FROM (
        SELECT duration FROM sessions WHERE member_id = ? AND team_id = ? ORDER BY start_time DESC LIMIT 3 OFFSET 3
      )
    `).get(member.id, teamId) as { avg: number };

    trends[member.id] = recent?.avg && previous?.avg
      ? ((recent.avg - previous.avg) / previous.avg) * 100
      : 0;
  }

  res.json({ members: membersAggregate, memberStats, sparklines: sparklineData, trends });
});

// Team settings endpoints
teamRouter.get('/settings', (req, res) => {
  const { teamId } = req.params;
  const team = db.prepare('SELECT stock_symbols, expected_seconds, pr_ingest_token_hash FROM teams WHERE id = ?').get(teamId) as { stock_symbols: string; expected_seconds: number; pr_ingest_token_hash: string | null } | undefined;
  res.json({
    stockSymbols: team?.stock_symbols || '',
    expectedSeconds: team?.expected_seconds ?? 90,
    // Whether a publisher ingest token exists (the token itself is never returned —
    // only its hash is stored; the raw value is shown once at generation time).
    prTokenConfigured: Boolean(team?.pr_ingest_token_hash),
  });
});

teamRouter.put('/settings', (req, res) => {
  const { teamId } = req.params;
  const { stockSymbols, expectedSeconds } = req.body;

  if (stockSymbols !== undefined) {
    db.prepare('UPDATE teams SET stock_symbols = ? WHERE id = ?').run(stockSymbols || '', teamId);
  }
  if (expectedSeconds !== undefined) {
    db.prepare('UPDATE teams SET expected_seconds = ? WHERE id = ?').run(expectedSeconds, teamId);
  }
  res.json({ success: true });
});

// Sprint goal endpoints
teamRouter.get('/sprint', (req, res) => {
  res.json(computeSprintStatus(req.params.teamId));
});

teamRouter.put('/sprint', (req, res) => {
  const { teamId } = req.params;
  const { goal, startDate, lengthDays, done, thresholds } = req.body;

  if (goal !== undefined) {
    db.prepare('UPDATE teams SET sprint_goal = ? WHERE id = ?').run(String(goal).slice(0, 200), teamId);
  }
  if (startDate !== undefined) {
    const v = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : '';
    db.prepare('UPDATE teams SET sprint_start = ? WHERE id = ?').run(v, teamId);
  }
  if (lengthDays !== undefined) {
    const n = Math.min(60, Math.max(1, Math.round(Number(lengthDays) || 14)));
    db.prepare('UPDATE teams SET sprint_length_days = ? WHERE id = ?').run(n, teamId);
  }
  if (thresholds !== undefined) {
    // Accept either {notice,warning,critical} or [n,w,c]; persist normalized + validated.
    const t = Array.isArray(thresholds)
      ? parseThresholds(thresholds.join(','))
      : parseThresholds(`${thresholds?.notice},${thresholds?.warning},${thresholds?.critical}`);
    db.prepare('UPDATE teams SET sprint_thresholds = ? WHERE id = ?')
      .run(`${t.notice},${t.warning},${t.critical}`, teamId);
  }
  if (done !== undefined) {
    db.prepare('UPDATE teams SET sprint_goal_done_at = ? WHERE id = ?').run(done ? Date.now() : null, teamId);
  }

  const status = computeSprintStatus(teamId);
  // Push the new state to every connected client so banners/dialogs update live.
  broadcastToTeam(teamId, { type: 'sprint', sprint: status });
  res.json(status);
});

// --- PR review queue --------------------------------------------------------
// PRs needing review are PUSHED in by a local publisher CLI (see
// scripts/publish-prs.ts) that runs where the private repo is reachable. The
// app server never talks to GitHub. Auth is a per-team bearer token; we store
// only its SHA-256 hash and compare in constant time.

interface PrInfo {
  author: string;
  title: string;
  repo: string;   // "owner/name"
  number: number;
}

const MAX_PRS = 200;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Constant-time compare of two hex-encoded SHA-256 hashes.
function tokensMatch(presented: string, expectedHashHex: string): boolean {
  const a = Buffer.from(hashToken(presented), 'hex');
  const b = Buffer.from(expectedHashHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function getPrStatus(teamId: string): { prs: PrInfo[]; syncedAt: number | null } {
  const row = db.prepare('SELECT payload, updated_at FROM pr_status WHERE team_id = ?')
    .get(teamId) as { payload: string; updated_at: number } | undefined;
  if (!row) return { prs: [], syncedAt: null };
  try {
    return { prs: JSON.parse(row.payload) as PrInfo[], syncedAt: row.updated_at };
  } catch {
    return { prs: [], syncedAt: null };
  }
}

// Rotate (or first-time generate) the team's ingest token. Returns the raw
// token ONCE — only its hash is stored, so it can't be retrieved later.
teamRouter.post('/pr-status/token', (req, res) => {
  const { teamId } = req.params;
  const token = randomBytes(24).toString('hex');
  db.prepare('UPDATE teams SET pr_ingest_token_hash = ? WHERE id = ?').run(hashToken(token), teamId);
  res.json({ token });
});

// Read the latest snapshot (initial load; live updates arrive via WS 'pr_status').
teamRouter.get('/pr-status', (req, res) => {
  res.json(getPrStatus(req.params.teamId));
});

// Ingest a fresh snapshot from the publisher CLI. Bearer-token authed.
teamRouter.post('/pr-status', (req, res) => {
  const { teamId } = req.params;
  const row = db.prepare('SELECT pr_ingest_token_hash FROM teams WHERE id = ?')
    .get(teamId) as { pr_ingest_token_hash: string | null } | undefined;
  const expected = row?.pr_ingest_token_hash;

  if (!expected) {
    res.status(403).json({ error: 'No ingest token configured. Run: npm run team pr-token ' + teamId });
    return;
  }

  const auth = req.header('authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !tokensMatch(presented, expected)) {
    res.status(401).json({ error: 'Invalid ingest token' });
    return;
  }

  // Normalize + bound the payload — the publisher already filtered, but never
  // trust the wire. Keep only the four minimal fields.
  const rawPrs = Array.isArray(req.body?.prs) ? req.body.prs : [];
  const prs: PrInfo[] = rawPrs
    .slice(0, MAX_PRS)
    .map((p: Partial<PrInfo>): PrInfo => ({
      author: String(p?.author ?? '').slice(0, 100),
      title: String(p?.title ?? '').slice(0, 300),
      repo: String(p?.repo ?? '').slice(0, 140),
      number: Number(p?.number) || 0,
    }))
    .filter((p: PrInfo) => p.repo && p.number > 0);

  const updatedAt = Date.now();
  db.prepare('INSERT OR REPLACE INTO pr_status (team_id, payload, updated_at) VALUES (?, ?, ?)')
    .run(teamId, JSON.stringify(prs), updatedAt);

  // Push to every connected client so panels update live (mirrors 'sprint').
  broadcastToTeam(teamId, { type: 'pr_status', prs, syncedAt: updatedAt });

  res.json({ ok: true, count: prs.length, syncedAt: updatedAt });
});

// Stock quotes endpoint - with 30-day history for charts
teamRouter.get('/stocks', async (req, res) => {
  const { teamId } = req.params;
  const team = db.prepare('SELECT stock_symbols FROM teams WHERE id = ?').get(teamId) as { stock_symbols: string } | undefined;

  const symbols = (team?.stock_symbols || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  if (symbols.length === 0) {
    res.json({ quotes: [] });
    return;
  }

  try {
    // Yahoo Finance v8 chart API with 30-day history
    const quotes = await Promise.all(symbols.map(async (symbol) => {
      try {
        const response = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }
        );

        if (!response.ok) return null;

        const data = await response.json() as {
          chart: {
            result: Array<{
              meta: {
                symbol: string;
                shortName: string;
                regularMarketPrice: number;
                previousClose: number;
              };
              indicators: {
                quote: Array<{
                  close: (number | null)[];
                }>;
              };
            }>;
          };
        };

        const result = data.chart?.result?.[0];
        if (!result) return null;

        const meta = result.meta;
        const closePrices = result.indicators?.quote?.[0]?.close?.filter((p): p is number => p !== null) || [];

        const change = meta.regularMarketPrice - meta.previousClose;
        const changePercent = (change / meta.previousClose) * 100;

        return {
          symbol: meta.symbol,
          name: meta.shortName || meta.symbol,
          price: meta.regularMarketPrice,
          change,
          changePercent,
          history: closePrices,
        };
      } catch {
        return null;
      }
    }));

    res.json({ quotes: quotes.filter(Boolean) });
  } catch (err) {
    console.error('Stock fetch error:', err);
    res.json({ quotes: [], error: 'Failed to fetch stock data' });
  }
});

// Mount team router with validation
app.use('/api/:teamId', validateTeam, teamRouter);

// SPA fallback - serve index.html for all non-API routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 Server running!\n');
  console.log(`   Local:    http://localhost:${PORT}`);

  const ips = getLocalIPs();
  if (ips.length > 0) {
    ips.forEach(ip => {
      console.log(`   Network:  http://${ip}:${PORT}`);
    });
  }
  console.log('');
});
