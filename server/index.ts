import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseUrl } from 'url';
import { networkInterfaces } from 'os';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

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
});

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

  // Send current state to new client
  const state = getTeamState(teamId);
  ws.send(JSON.stringify({ type: 'state', ...state }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const timerState = getTeamState(teamId);

      switch (msg.type) {
        case 'start':
          if (timerState.status === 'idle') {
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
          timerState.currentSpeaker = null;
          timerState.standupId = null;
          timerState.status = 'idle';
          timerState.elapsedTime = 0;
          timerState.interruptions = 0;
          timerState.startTime = null;
          timerState.totalPaused = 0;
          timerState.pauseStart = null;
          broadcastToTeam(teamId, { type: 'state', ...timerState });
          break;

        case 'getState':
          ws.send(JSON.stringify({ type: 'state', ...timerState }));
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
  `).all(teamId);
  res.json(members.map((m: any) => ({ ...m, isGuest: Boolean(m.isGuest) })));
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
  const team = db.prepare('SELECT stock_symbols, expected_seconds FROM teams WHERE id = ?').get(teamId) as { stock_symbols: string; expected_seconds: number } | undefined;
  res.json({
    stockSymbols: team?.stock_symbols || '',
    expectedSeconds: team?.expected_seconds ?? 90,
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
  app.get('*', (_req, res) => {
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
