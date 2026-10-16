/**
 * API Behavior Tests
 * Tests the HTTP API endpoints for teams, members, sessions, and trends
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TEST_PORT, generateTeamId, TEST_DB_PATH } from './test-helpers';
import Database from 'better-sqlite3';

// Helper to make API requests
async function api(method: string, path: string, body?: object) {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${path}`, options);
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('application/json') 
      ? await response.json() 
      : null,
  };
}

// Create a fresh team for each test
function createTeamInDb(name: string, members: string[] = []): string {
  const db = new Database(TEST_DB_PATH);
  const teamId = generateTeamId();
  db.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').run(teamId, name);
  
  for (const memberName of members) {
    const memberId = crypto.randomUUID();
    db.prepare('INSERT INTO team_members (id, name, team_id, is_guest) VALUES (?, ?, ?, 0)')
      .run(memberId, memberName, teamId);
  }
  
  db.close();
  return teamId;
}

test.describe('Server Info API', () => {
  test('GET /api/server-info returns server information', async () => {
    const { status, data } = await api('GET', '/api/server-info');
    
    expect(status).toBe(200);
    expect(data).toHaveProperty('port');
    expect(data).toHaveProperty('localUrl');
    expect(data).toHaveProperty('networkUrls');
    expect(data.port).toBe(TEST_PORT);
  });
});

test.describe('Team Validation', () => {
  test('returns 404 for non-existent team', async () => {
    const { status, data } = await api('GET', '/api/invalidteam/members');
    
    expect(status).toBe(404);
    expect(data.error).toBe('Team not found');
  });
});

test.describe('Team Members API', () => {
  test('GET /api/:teamId/members returns empty array for new team', async () => {
    const teamId = createTeamInDb('Test Team');
    const { status, data } = await api('GET', `/api/${teamId}/members`);
    
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test('GET /api/:teamId/members returns existing members', async () => {
    const teamId = createTeamInDb('Test Team', ['Alice', 'Bob', 'Charlie']);
    const { status, data } = await api('GET', `/api/${teamId}/members`);
    
    expect(status).toBe(200);
    expect(data.length).toBe(3);
    expect(data.map((m: { name: string }) => m.name)).toContain('Alice');
    expect(data.map((m: { name: string }) => m.name)).toContain('Bob');
    expect(data.map((m: { name: string }) => m.name)).toContain('Charlie');
  });

  test('POST /api/:teamId/members creates a new member', async () => {
    const teamId = createTeamInDb('Test Team');
    const memberId = crypto.randomUUID();
    
    const { status, data } = await api('POST', `/api/${teamId}/members`, {
      id: memberId,
      name: 'Dave',
      isGuest: false,
    });
    
    expect(status).toBe(200);
    expect(data.name).toBe('Dave');
    expect(data.isGuest).toBe(false);
    
    // Verify member was actually created
    const { data: members } = await api('GET', `/api/${teamId}/members`);
    expect(members.length).toBe(1);
    expect(members[0].name).toBe('Dave');
  });

  test('POST /api/:teamId/members creates a guest member', async () => {
    const teamId = createTeamInDb('Test Team');
    const memberId = crypto.randomUUID();
    
    const { status, data } = await api('POST', `/api/${teamId}/members`, {
      id: memberId,
      name: 'Guest User',
      isGuest: true,
    });
    
    expect(status).toBe(200);
    expect(data.isGuest).toBe(true);
    
    // Verify guest flag is persisted
    const { data: members } = await api('GET', `/api/${teamId}/members`);
    const guest = members.find((m: { name: string; isGuest: boolean }) => m.name === "Guest User");
    expect(guest.isGuest).toBe(true);
  });

  test('DELETE /api/:teamId/members/:id removes a member', async () => {
    const teamId = createTeamInDb('Test Team', ['Alice']);
    let { data: members } = await api('GET', `/api/${teamId}/members`);
    const aliceId = members[0].id;
    
    const { status } = await api('DELETE', `/api/${teamId}/members/${aliceId}`);
    expect(status).toBe(200);
    
    // Verify member was deleted
    ({ data: members } = await api('GET', `/api/${teamId}/members`));
    expect(members.length).toBe(0);
  });
});

test.describe('Sessions API', () => {
  test('GET /api/:teamId/sessions returns empty array for new team', async () => {
    const teamId = createTeamInDb('Test Team');
    const { status, data } = await api('GET', `/api/${teamId}/sessions`);
    
    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test('POST /api/:teamId/sessions creates a session and updates standup aggregate', async () => {
    const teamId = createTeamInDb('Test Team', ['Alice']);
    const { data: members } = await api('GET', `/api/${teamId}/members`);
    const alice = members[0];

    const standupId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    const { status, data } = await api('POST', `/api/${teamId}/sessions`, {
      id: sessionId,
      memberId: alice.id,
      memberName: alice.name,
      standupId,
      startTime: now - 60000, // 1 minute ago
      endTime: now,
      duration: 60000,
      interruptions: 2,
      pausedDuration: 5000,
    });

    expect(status).toBe(200);
    expect(data.duration).toBe(60000);

    // Verify session was created
    const { data: sessions } = await api('GET', `/api/${teamId}/sessions`);
    expect(sessions.length).toBe(1);
    expect(sessions[0].memberName).toBe('Alice');
    expect(sessions[0].interruptions).toBe(2);
  });

  test('PUT /api/:teamId/sessions/:id updates a session', async () => {
    const teamId = createTeamInDb('Test Team', ['Bob']);
    const { data: members } = await api('GET', `/api/${teamId}/members`);
    const bob = members[0];

    const standupId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    // Create initial session
    await api('POST', `/api/${teamId}/sessions`, {
      id: sessionId,
      memberId: bob.id,
      memberName: bob.name,
      standupId,
      startTime: now - 60000,
      endTime: now,
      duration: 60000,
      interruptions: 0,
      pausedDuration: 0,
    });

    // Update the session
    const { status } = await api('PUT', `/api/${teamId}/sessions/${sessionId}`, {
      standupId,
      endTime: now + 30000,
      duration: 90000,
      interruptions: 1,
      pausedDuration: 10000,
    });

    expect(status).toBe(200);

    // Verify update was applied
    const { data: sessions } = await api('GET', `/api/${teamId}/sessions`);
    const session = sessions.find((s: { id: string }) => s.id === sessionId);
    expect(session.duration).toBe(90000);
    expect(session.interruptions).toBe(1);
  });

  test('DELETE /api/:teamId/sessions clears all sessions', async () => {
    const teamId = createTeamInDb('Test Team', ['Alice', 'Bob']);
    const { data: members } = await api('GET', `/api/${teamId}/members`);

    const standupId = crypto.randomUUID();
    const now = Date.now();

    // Create sessions for both members
    for (const member of members) {
      await api('POST', `/api/${teamId}/sessions`, {
        id: crypto.randomUUID(),
        memberId: member.id,
        memberName: member.name,
        standupId,
        startTime: now - 60000,
        endTime: now,
        duration: 60000,
        interruptions: 0,
        pausedDuration: 0,
      });
    }

    // Verify sessions exist
    let { data: sessions } = await api('GET', `/api/${teamId}/sessions`);
    expect(sessions.length).toBe(2);

    // Delete all sessions
    const { status } = await api('DELETE', `/api/${teamId}/sessions`);
    expect(status).toBe(200);

    // Verify sessions are gone
    ({ data: sessions } = await api('GET', `/api/${teamId}/sessions`));
    expect(sessions.length).toBe(0);
  });
});

test.describe('Sync Notes API', () => {
  test('GET /api/:teamId/notes returns empty array without a standupId', async () => {
    const teamId = createTeamInDb('Notes API Team');
    const { status, data } = await api('GET', `/api/${teamId}/notes`);

    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test('GET /api/:teamId/notes returns a standup\'s notes in chronological order', async () => {
    const teamId = createTeamInDb('Notes API Team');
    const standupId = crypto.randomUUID();

    const db = new Database(TEST_DB_PATH);
    const insert = db.prepare(
      'INSERT INTO sync_notes (id, team_id, standup_id, text, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    insert.run(crypto.randomUUID(), teamId, standupId, 'Second', 2000);
    insert.run(crypto.randomUUID(), teamId, standupId, 'First', 1000);
    // A note for a different standup should not leak in
    insert.run(crypto.randomUUID(), teamId, crypto.randomUUID(), 'Other standup', 1500);
    db.close();

    const { status, data } = await api('GET', `/api/${teamId}/notes?standupId=${standupId}`);

    expect(status).toBe(200);
    expect(data.map((n: { text: string }) => n.text)).toEqual(['First', 'Second']);
  });
});

test.describe('Team Settings API', () => {
  test('GET /api/:teamId/settings returns default settings', async () => {
    const teamId = createTeamInDb('Test Team');
    const { status, data } = await api('GET', `/api/${teamId}/settings`);

    expect(status).toBe(200);
    expect(data.stockSymbols).toBe('');
    expect(data.expectedSeconds).toBe(90);
  });

  test('PUT /api/:teamId/settings updates stock symbols', async () => {
    const teamId = createTeamInDb('Test Team');

    const { status } = await api('PUT', `/api/${teamId}/settings`, {
      stockSymbols: 'AAPL,GOOGL,MSFT',
    });

    expect(status).toBe(200);

    // Verify update
    const { data } = await api('GET', `/api/${teamId}/settings`);
    expect(data.stockSymbols).toBe('AAPL,GOOGL,MSFT');
  });

  test('PUT /api/:teamId/settings updates expected seconds', async () => {
    const teamId = createTeamInDb('Test Team');

    const { status } = await api('PUT', `/api/${teamId}/settings`, {
      expectedSeconds: 120,
    });

    expect(status).toBe(200);

    // Verify update
    const { data } = await api('GET', `/api/${teamId}/settings`);
    expect(data.expectedSeconds).toBe(120);
  });
});

test.describe('Sprint Goal API', () => {
  // A start date N days before today (local), formatted as YYYY-MM-DD.
  function daysAgoISO(n: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  test('GET /api/:teamId/sprint returns unconfigured defaults', async () => {
    const teamId = createTeamInDb('Test Team');
    const { status, data } = await api('GET', `/api/${teamId}/sprint`);

    expect(status).toBe(200);
    expect(data.configured).toBe(false);
    expect(data.hasGoal).toBe(false);
    expect(data.done).toBe(false);
    expect(data.lengthDays).toBe(14);
    expect(data.level).toBe('idle');
  });

  test('PUT /api/:teamId/sprint configures the current sprint window', async () => {
    const teamId = createTeamInDb('Test Team');

    const { status, data } = await api('PUT', `/api/${teamId}/sprint`, {
      goal: 'Ship checkout v2',
      startDate: daysAgoISO(5),
      lengthDays: 14,
    });

    expect(status).toBe(200);
    expect(data.configured).toBe(true);
    expect(data.hasGoal).toBe(true);
    expect(data.goal).toBe('Ship checkout v2');
    expect(data.dayOfSprint).toBe(6);   // day 0 is the start date, so 5 days later is day 6
    expect(data.daysLeft).toBe(9);      // 14 - 5 elapsed; includes today, so the last day reads 1
    expect(data.elapsedFraction).toBeGreaterThan(0.4);
    expect(data.elapsedFraction).toBeLessThan(0.5);
    expect(data.level).toBe('notice');  // >5 days left, but past the 0.4 elapsed nudge
  });

  test('PUT /api/:teamId/sprint goes critical 3 days before the end', async () => {
    const teamId = createTeamInDb('Test Team');
    // 14-day sprint started 11 days ago => day 12 => 3 days left (12,13,14) => critical.
    const { data } = await api('PUT', `/api/${teamId}/sprint`, {
      goal: 'Cut the release',
      startDate: daysAgoISO(11),
      lengthDays: 14,
    });

    expect(data.daysLeft).toBe(3);
    expect(data.level).toBe('critical');
  });

  test('PUT /api/:teamId/sprint toggles the done flag', async () => {
    const teamId = createTeamInDb('Test Team');
    await api('PUT', `/api/${teamId}/sprint`, { goal: 'Goal', startDate: daysAgoISO(1), lengthDays: 14 });

    const done = await api('PUT', `/api/${teamId}/sprint`, { done: true });
    expect(done.data.done).toBe(true);
    expect(done.data.level).toBe('done');

    const undone = await api('PUT', `/api/${teamId}/sprint`, { done: false });
    expect(undone.data.done).toBe(false);
  });

  test('a goal does not leak into the next sprint window', async () => {
    const teamId = createTeamInDb('Test Team');
    // Cadence started 20 days ago with 14-day sprints => we're in window index 1
    // now (day 7 of the second sprint). Plant a goal in the PAST window only.
    const start = daysAgoISO(20);
    await api('PUT', `/api/${teamId}/sprint`, { startDate: start, lengthDays: 14 });

    const db = new Database(TEST_DB_PATH);
    db.prepare(
      'INSERT INTO sprint_goals (team_id, start_date, goal, length_days, set_at, done_at) VALUES (?, ?, ?, ?, ?, NULL)'
    ).run(teamId, start, 'Old window goal', 14, Date.now());
    db.close();

    // The current window is a different start date, so it has no goal: the banner
    // shows the "set a goal" (empty) state rather than the stale one.
    const { data } = await api('GET', `/api/${teamId}/sprint`);
    expect(data.configured).toBe(true);
    expect(data.hasGoal).toBe(false);
    expect(data.goal).toBe('');
    expect(data.level).toBe('empty');

    // The old goal is still archived in the history.
    const history = await api('GET', `/api/${teamId}/sprint/history`);
    expect(history.data.some((g: { goal: string }) => g.goal === 'Old window goal')).toBe(true);
  });
});

test.describe('PR Status API', () => {
  // Authed POST to the ingest endpoint (the shared `api` helper can't set headers).
  async function ingest(teamId: string, token: string | null, body: object) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${BASE_URL}/api/${teamId}/pr-status`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => null) };
  }

  // Mint the first token, or rotate by presenting the current one.
  async function mintToken(teamId: string, current?: string): Promise<string> {
    const response = await fetch(`${BASE_URL}/api/${teamId}/pr-status/token`, {
      method: 'POST',
      headers: current ? { Authorization: `Bearer ${current}` } : {},
    });
    const data = await response.json();
    return data.token as string;
  }

  test('GET returns empty queue before anything is published', async () => {
    const teamId = createTeamInDb('PR Team');
    const { status, data } = await api('GET', `/api/${teamId}/pr-status`);

    expect(status).toBe(200);
    expect(data.prs).toEqual([]);
    expect(data.syncedAt).toBeNull();
  });

  test('settings reports prTokenConfigured false until a token is generated', async () => {
    const teamId = createTeamInDb('PR Team');

    const before = await api('GET', `/api/${teamId}/settings`);
    expect(before.data.prTokenConfigured).toBe(false);

    await mintToken(teamId);

    const after = await api('GET', `/api/${teamId}/settings`);
    expect(after.data.prTokenConfigured).toBe(true);
  });

  test('token generation returns a raw token but the GET never exposes it', async () => {
    const teamId = createTeamInDb('PR Team');
    const token = await mintToken(teamId);

    expect(token).toMatch(/^[0-9a-f]{48}$/);

    // The token must not leak through settings or the queue read.
    const settings = await api('GET', `/api/${teamId}/settings`);
    expect(JSON.stringify(settings.data)).not.toContain(token);
  });

  test('ingest is rejected before a token exists (403)', async () => {
    const teamId = createTeamInDb('PR Team');
    const { status } = await ingest(teamId, 'anything', { prs: [] });
    expect(status).toBe(403);
  });

  test('ingest with a valid token stores the queue and stamps syncedAt', async () => {
    const teamId = createTeamInDb('PR Team');
    const token = await mintToken(teamId);

    const before = Date.now();
    const post = await ingest(teamId, token, {
      prs: [
        { author: 'alice', title: 'Fix retry backoff', repo: 'acme/web', number: 482 },
        { author: 'bob', title: 'Add metrics', repo: 'acme/web', number: 501 },
      ],
    });
    expect(post.status).toBe(200);
    expect(post.data.count).toBe(2);

    const { data } = await api('GET', `/api/${teamId}/pr-status`);
    expect(data.prs).toHaveLength(2);
    expect(data.prs[0]).toEqual({ author: 'alice', title: 'Fix retry backoff', repo: 'acme/web', number: 482 });
    expect(data.syncedAt).toBeGreaterThanOrEqual(before);
  });

  test('ingest with a wrong token is rejected (401)', async () => {
    const teamId = createTeamInDb('PR Team');
    await mintToken(teamId);

    const { status } = await ingest(teamId, 'deadbeef'.repeat(6), { prs: [] });
    expect(status).toBe(401);
  });

  test('rotating the token invalidates the previous one', async () => {
    const teamId = createTeamInDb('PR Team');
    const first = await mintToken(teamId);
    const second = await mintToken(teamId, first);
    expect(second).not.toBe(first);

    expect((await ingest(teamId, first, { prs: [] })).status).toBe(401);
    expect((await ingest(teamId, second, { prs: [] })).status).toBe(200);
  });

  test('rotating an existing token requires presenting the current one', async () => {
    const teamId = createTeamInDb('PR Team');
    const token = await mintToken(teamId);

    // Knowing only the team URL is not enough to hijack the publisher feed.
    const anonymous = await api('POST', `/api/${teamId}/pr-status/token`);
    expect(anonymous.status).toBe(401);
    const wrong = await fetch(`${BASE_URL}/api/${teamId}/pr-status/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'deadbeef'.repeat(6)}` },
    });
    expect(wrong.status).toBe(401);

    // The original token still works.
    expect((await ingest(teamId, token, { prs: [] })).status).toBe(200);
  });

  test('ingest strips extra fields and drops malformed entries', async () => {
    const teamId = createTeamInDb('PR Team');
    const token = await mintToken(teamId);

    await ingest(teamId, token, {
      prs: [
        { author: 'alice', title: 'Good', repo: 'acme/web', number: 1, reviewDecision: 'REVIEW_REQUIRED', secret: 'x' },
        { author: 'bob', title: 'No repo', number: 2 },   // dropped: missing repo
        { author: 'carol', title: 'No number', repo: 'acme/web' }, // dropped: missing number
      ],
    });

    const { data } = await api('GET', `/api/${teamId}/pr-status`);
    expect(data.prs).toHaveLength(1);
    expect(data.prs[0]).toEqual({ author: 'alice', title: 'Good', repo: 'acme/web', number: 1 });
    expect(Object.keys(data.prs[0]).sort()).toEqual(['author', 'number', 'repo', 'title']);
  });
});

test.describe('Trends API', () => {
  // Helper to create standup data
  async function createStandupData(teamId: string) {
    const { data: members } = await api('GET', `/api/${teamId}/members`);
    const now = Date.now();

    // Create 5 standups over the past week
    for (let day = 0; day < 5; day++) {
      const standupId = crypto.randomUUID();
      const standupTime = now - (day * 24 * 60 * 60 * 1000);

      for (const member of members) {
        await api('POST', `/api/${teamId}/sessions`, {
          id: crypto.randomUUID(),
          memberId: member.id,
          memberName: member.name,
          standupId,
          startTime: standupTime - 120000 + (members.indexOf(member) * 60000),
          endTime: standupTime - 60000 + (members.indexOf(member) * 60000),
          duration: 60000 + (Math.random() * 30000), // 60-90 seconds each
          interruptions: Math.floor(Math.random() * 3),
          pausedDuration: Math.floor(Math.random() * 10000),
        });
      }
    }
  }

  test('GET /api/:teamId/trends/standups returns standup history', async () => {
    const teamId = createTeamInDb('Trends Test Team', ['Alice', 'Bob']);
    await createStandupData(teamId);

    const { status, data } = await api('GET', `/api/${teamId}/trends/standups?days=30`);

    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    // Each standup should have required fields
    const standup = data[0];
    expect(standup).toHaveProperty('id');
    expect(standup).toHaveProperty('date');
    expect(standup).toHaveProperty('dayOfWeek');
    expect(standup).toHaveProperty('totalDuration');
    expect(standup).toHaveProperty('speakerCount');
  });

  test('GET /api/:teamId/trends/team returns team overview statistics', async () => {
    const teamId = createTeamInDb('Trends Test Team 2', ['Charlie', 'Dave']);
    await createStandupData(teamId);

    const { status, data } = await api('GET', `/api/${teamId}/trends/team?days=30`);

    expect(status).toBe(200);
    expect(data).toHaveProperty('overall');
    expect(data).toHaveProperty('byDayOfWeek');
    expect(data).toHaveProperty('trend');
    expect(data).toHaveProperty('dailyStandups');

    expect(data.overall.standupCount).toBeGreaterThan(0);
    expect(data.overall.avgDuration).toBeGreaterThan(0);
  });

  test('GET /api/:teamId/trends/members returns member statistics', async () => {
    const teamId = createTeamInDb('Trends Test Team 3', ['Eve', 'Frank']);
    await createStandupData(teamId);

    const { status, data } = await api('GET', `/api/${teamId}/trends/members?days=30`);

    expect(status).toBe(200);
    expect(data).toHaveProperty('members');
    expect(data).toHaveProperty('memberStats');
    expect(data).toHaveProperty('sparklines');
    expect(data).toHaveProperty('trends');

    expect(data.members.length).toBe(2);
    expect(data.members.map((m: { memberName: string }) => m.memberName)).toContain('Eve');
    expect(data.members.map((m: { memberName: string }) => m.memberName)).toContain('Frank');
  });

  test('trends respect days query parameter', async () => {
    const teamId = createTeamInDb('Trends Test Team 4', ['Grace']);
    await createStandupData(teamId);

    // 7-day trends should return data
    const { data: sevenDays } = await api('GET', `/api/${teamId}/trends/team?days=7`);
    expect(sevenDays.overall.standupCount).toBeGreaterThan(0);

    // 1-day trends should return less or equal data
    const { data: oneDay } = await api('GET', `/api/${teamId}/trends/team?days=1`);
    expect(oneDay.overall.standupCount).toBeLessThanOrEqual(sevenDays.overall.standupCount);
  });
});

test.describe('Input Validation', () => {
  test('POST members rejects a missing name and generates an id when omitted', async () => {
    const teamId = createTeamInDb('Validation Team');

    expect((await api('POST', `/api/${teamId}/members`, { id: crypto.randomUUID() })).status).toBe(400);
    expect((await api('POST', `/api/${teamId}/members`, { name: { evil: true } })).status).toBe(400);

    const { status, data } = await api('POST', `/api/${teamId}/members`, { name: '  Zed  ' });
    expect(status).toBe(200);
    expect(data.name).toBe('Zed');
    expect(typeof data.id).toBe('string');
  });

  test('POST sessions rejects non-numeric durations', async () => {
    const teamId = createTeamInDb('Validation Team');
    const { status } = await api('POST', `/api/${teamId}/sessions`, {
      id: crypto.randomUUID(), memberId: crypto.randomUUID(), memberName: 'A',
      standupId: crypto.randomUUID(), startTime: Date.now(), endTime: Date.now(),
      duration: 'lots', interruptions: 0, pausedDuration: 0,
    });
    expect(status).toBe(400);
  });

  test('PUT settings rejects a bad expectedSeconds and normalizes stock symbols', async () => {
    const teamId = createTeamInDb('Validation Team');

    expect((await api('PUT', `/api/${teamId}/settings`, { expectedSeconds: 'abc' })).status).toBe(400);
    expect((await api('PUT', `/api/${teamId}/settings`, { expectedSeconds: -5 })).status).toBe(400);

    await api('PUT', `/api/${teamId}/settings`, { stockSymbols: 'aapl, ../../v7/x?y=1 ,msft,AAPL' });
    const { data } = await api('GET', `/api/${teamId}/settings`);
    expect(data.stockSymbols).toBe('AAPL,MSFT');
  });

  test('PUT sprint rejects a start date that is not a real calendar date', async () => {
    const teamId = createTeamInDb('Validation Team');
    const { status } = await api('PUT', `/api/${teamId}/sprint`, { startDate: '2025-13-45', lengthDays: 14 });
    expect(status).toBe(400);
  });

  test('re-anchoring the sprint cadence keeps the current goal', async () => {
    const teamId = createTeamInDb('Cadence Team');
    const iso = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    await api('PUT', `/api/${teamId}/sprint`, { goal: 'Keep me', startDate: iso(3), lengthDays: 14 });

    const { data } = await api('PUT', `/api/${teamId}/sprint`, { startDate: iso(1) });
    expect(data.windowStart).toBe(iso(1));
    expect(data.goal).toBe('Keep me');
  });
});

test.describe('Tenant Isolation', () => {
  test("a team cannot overwrite another team's standup record", async () => {
    const victim = createTeamInDb('Victim Team');
    const attacker = createTeamInDb('Attacker Team');
    const standupId = crypto.randomUUID();
    const victimMember = (await api('POST', `/api/${victim}/members`, { name: 'V' })).data.id;
    const attackerMember = (await api('POST', `/api/${attacker}/members`, { name: 'A' })).data.id;
    const session = (memberId: string, duration: number) => ({
      id: crypto.randomUUID(), memberId, memberName: 'X', standupId,
      startTime: Date.now() - 60000, endTime: Date.now(), duration, interruptions: 0, pausedDuration: 0,
    });

    expect((await api('POST', `/api/${victim}/sessions`, session(victimMember, 1000))).status).toBe(200);
    expect((await api('POST', `/api/${attacker}/sessions`, session(attackerMember, 999999))).status).toBe(200);

    const { data: victimStandups } = await api('GET', `/api/${victim}/trends/standups`);
    expect(victimStandups).toHaveLength(1);
    expect(victimStandups[0].totalDuration).toBe(1000);
    const { data: attackerStandups } = await api('GET', `/api/${attacker}/trends/standups`);
    expect(attackerStandups).toHaveLength(0);
  });

  test('clearing sessions also removes notes of finished standups', async () => {
    const teamId = createTeamInDb('Clear Team');
    const db = new Database(TEST_DB_PATH);
    db.prepare('INSERT INTO sync_notes (id, team_id, standup_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), teamId, 'old-standup', 'stale', Date.now());
    db.close();

    await api('DELETE', `/api/${teamId}/sessions`);
    const { data } = await api('GET', `/api/${teamId}/notes?standupId=old-standup`);
    expect(data).toEqual([]);
  });
});

test.describe('HTTP Hardening', () => {
  test('responses carry security headers', async () => {
    const response = await fetch(`${BASE_URL}/api/version`);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  test('cross-origin requests from other sites are not allowed', async () => {
    const teamId = createTeamInDb('CORS Team');
    const response = await fetch(`${BASE_URL}/api/${teamId}/members`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('healthz responds without exposing details', async () => {
    const { status, data } = await api('GET', '/healthz');
    expect(status).toBe(200);
    expect(data).toEqual({ ok: true });
  });
});
