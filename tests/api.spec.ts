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
    expect(data.thresholds).toEqual({ notice: 7, warning: 3, critical: 1 });
  });

  test('PUT /api/:teamId/sprint configures the current sprint window', async () => {
    const teamId = createTeamInDb('Test Team');

    const { status, data } = await api('PUT', `/api/${teamId}/sprint`, {
      goal: 'Ship checkout v2',
      startDate: daysAgoISO(5),
      lengthDays: 14,
      thresholds: { notice: 5, warning: 3, critical: 1 },
    });

    expect(status).toBe(200);
    expect(data.configured).toBe(true);
    expect(data.hasGoal).toBe(true);
    expect(data.goal).toBe('Ship checkout v2');
    expect(data.daysRemaining).toBe(8); // 14 - 5, minus today (days left are counted after today)
    expect(data.elapsedFraction).toBeGreaterThan(0.3);
    expect(data.elapsedFraction).toBeLessThan(0.5);
    expect(data.thresholds).toEqual({ notice: 5, warning: 3, critical: 1 });
  });

  test('PUT /api/:teamId/sprint toggles the done flag', async () => {
    const teamId = createTeamInDb('Test Team');
    await api('PUT', `/api/${teamId}/sprint`, { goal: 'Goal', startDate: daysAgoISO(1), lengthDays: 14 });

    const done = await api('PUT', `/api/${teamId}/sprint`, { done: true });
    expect(done.data.done).toBe(true);

    const undone = await api('PUT', `/api/${teamId}/sprint`, { done: false });
    expect(undone.data.done).toBe(false);
  });

  test('PUT /api/:teamId/sprint rejects malformed thresholds, falling back to defaults', async () => {
    const teamId = createTeamInDb('Test Team');

    // Ascending day counts are invalid (notice must be the largest) and should be
    // replaced by the defaults.
    const { data } = await api('PUT', `/api/${teamId}/sprint`, {
      thresholds: { notice: 1, warning: 3, critical: 7 },
    });

    expect(data.thresholds).toEqual({ notice: 7, warning: 3, critical: 1 });
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

  async function mintToken(teamId: string): Promise<string> {
    const { data } = await api('POST', `/api/${teamId}/pr-status/token`);
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
    const second = await mintToken(teamId);
    expect(second).not.toBe(first);

    expect((await ingest(teamId, first, { prs: [] })).status).toBe(401);
    expect((await ingest(teamId, second, { prs: [] })).status).toBe(200);
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
