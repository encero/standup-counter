/**
 * WebSocket Behavior Tests
 * Tests real-time timer sync, start/pause/resume/stop, multi-client synchronization
 */
import { test, expect } from '@playwright/test';
import { WebSocket, type RawData } from 'ws';
import { WS_BASE, generateTeamId, TEST_DB_PATH } from './test-helpers';
import Database from 'better-sqlite3';

// Parsed WebSocket message; concrete fields are read ad hoc in assertions.
type WsMessage = { type: string; [key: string]: unknown };

// Helper to create a team directly in the database
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

// Helper to create a WebSocket connection that returns initial state
function connectWebSocket(teamId: string): Promise<{ ws: WebSocket; initialState: WsMessage }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws/${teamId}`);
    
    ws.on('open', () => {
      // Wait for initial state message
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'state') {
          resolve({ ws, initialState: msg });
        }
      } catch (err) {
        reject(err);
      }
    });
    
    ws.on('error', reject);
    
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
  });
}

// Helper to wait for a specific message type
function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<WsMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type} message`)), timeout);

    const handler = (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };
    
    ws.on('message', handler);
  });
}

// Helper to send a message and wait for state response
async function sendAndWaitForState(ws: WebSocket, message: object): Promise<WsMessage> {
  ws.send(JSON.stringify(message));
  return waitForMessage(ws, 'state');
}

test.describe('WebSocket Connection', () => {
  test('connects successfully to valid team', async () => {
    const teamId = createTeamInDb('WS Test Team');
    const { ws, initialState } = await connectWebSocket(teamId);
    
    expect(initialState.type).toBe('state');
    expect(initialState.status).toBe('idle');
    expect(initialState.currentSpeaker).toBeNull();
    expect(initialState.elapsedTime).toBe(0);
    
    ws.close();
  });

  test('rejects connection for non-existent team', async () => {
    const ws = new WebSocket(`${WS_BASE}/ws/nonexistent`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        resolve();
      });
      
      ws.on('error', () => {
        // Connection errors are expected
        resolve();
      });
      
      setTimeout(() => reject(new Error('Expected connection to be rejected')), 3000);
    });
  });

  test('rejects connection without team ID', async () => {
    const ws = new WebSocket(`${WS_BASE}/ws/`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on('close', (code) => {
        expect(code).toBe(4000);
        resolve();
      });
      
      ws.on('error', () => {
        resolve();
      });
      
      setTimeout(() => reject(new Error('Expected connection to be rejected')), 3000);
    });
  });
});

test.describe('Timer Operations', () => {
  test('start timer with speaker', async () => {
    const teamId = createTeamInDb('Timer Test Team', ['Alice']);
    const { ws } = await connectWebSocket(teamId);
    
    const speaker = { id: crypto.randomUUID(), name: 'Alice' };
    const state = await sendAndWaitForState(ws, { type: 'start', speaker });
    
    expect(state.status).toBe('running');
    expect(state.currentSpeaker.name).toBe('Alice');
    expect(state.standupId).toBeTruthy();
    expect(state.interruptions).toBe(0);
    
    ws.close();
  });

  test('pause running timer increments interruptions', async () => {
    const teamId = createTeamInDb('Pause Test Team', ['Bob']);
    const { ws } = await connectWebSocket(teamId);

    // Start timer
    const speaker = { id: crypto.randomUUID(), name: 'Bob' };
    await sendAndWaitForState(ws, { type: 'start', speaker });

    // Pause timer
    const pausedState = await sendAndWaitForState(ws, { type: 'pause' });

    expect(pausedState.status).toBe('paused');
    expect(pausedState.interruptions).toBe(1);

    ws.close();
  });

  test('resume paused timer', async () => {
    const teamId = createTeamInDb('Resume Test Team', ['Charlie']);
    const { ws } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Charlie' };
    await sendAndWaitForState(ws, { type: 'start', speaker });
    await sendAndWaitForState(ws, { type: 'pause' });

    const resumedState = await sendAndWaitForState(ws, { type: 'resume' });

    expect(resumedState.status).toBe('running');
    expect(resumedState.interruptions).toBe(1); // Still 1 from the pause

    ws.close();
  });

  test('stop timer resets state and broadcasts end_standup', async () => {
    const teamId = createTeamInDb('Stop Test Team', ['Dave']);
    const { ws } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Dave' };
    const startState = await sendAndWaitForState(ws, { type: 'start', speaker });
    const standupId = startState.standupId;

    // Set up listeners before sending stop command
    const endMsgPromise = waitForMessage(ws, 'end_standup');
    const stateMsgPromise = waitForMessage(ws, 'state');

    // Stop timer - expect end_standup message followed by state
    ws.send(JSON.stringify({ type: 'stop' }));

    const endMsg = await endMsgPromise;
    expect(endMsg.standupId).toBe(standupId);

    const stoppedState = await stateMsgPromise;
    expect(stoppedState.status).toBe('idle');
    expect(stoppedState.currentSpeaker).toBeNull();
    expect(stoppedState.standupId).toBeNull();
    expect(stoppedState.elapsedTime).toBe(0);

    ws.close();
  });

  test('switching speakers maintains standupId', async () => {
    const teamId = createTeamInDb('Switch Speaker Team', ['Eve', 'Frank']);
    const { ws } = await connectWebSocket(teamId);

    const eve = { id: crypto.randomUUID(), name: 'Eve' };
    const frank = { id: crypto.randomUUID(), name: 'Frank' };

    const firstState = await sendAndWaitForState(ws, { type: 'start', speaker: eve });
    const standupId = firstState.standupId;

    const secondState = await sendAndWaitForState(ws, { type: 'start', speaker: frank });

    expect(secondState.standupId).toBe(standupId); // Same standup
    expect(secondState.currentSpeaker.name).toBe('Frank');
    expect(secondState.elapsedTime).toBe(0); // Timer resets for new speaker

    ws.close();
  });

  test('getState returns current state', async () => {
    const teamId = createTeamInDb('GetState Test Team', ['Grace']);
    const { ws } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Grace' };
    await sendAndWaitForState(ws, { type: 'start', speaker });

    // Wait a bit for elapsed time to accumulate
    await new Promise(resolve => setTimeout(resolve, 200));

    const state = await sendAndWaitForState(ws, { type: 'getState' });

    expect(state.status).toBe('running');
    expect(state.currentSpeaker.name).toBe('Grace');
    expect(state.elapsedTime).toBeGreaterThan(0);

    ws.close();
  });
});

test.describe('Multi-Client Synchronization', () => {
  test('state changes broadcast to all connected clients', async () => {
    const teamId = createTeamInDb('Multi-Client Team', ['Henry']);

    // Connect two clients
    const { ws: client1 } = await connectWebSocket(teamId);
    const { ws: client2 } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Henry' };

    // Client 1 starts the timer
    const statePromise = waitForMessage(client2, 'state');
    client1.send(JSON.stringify({ type: 'start', speaker }));

    // Client 2 should receive the state update
    const client2State = await statePromise;
    expect(client2State.status).toBe('running');
    expect(client2State.currentSpeaker.name).toBe('Henry');

    client1.close();
    client2.close();
  });

  test('tick messages broadcast elapsed time to all clients', async () => {
    const teamId = createTeamInDb('Tick Broadcast Team', ['Ivy']);

    const { ws: client1 } = await connectWebSocket(teamId);
    const { ws: client2 } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Ivy' };
    await sendAndWaitForState(client1, { type: 'start', speaker });

    // Wait for tick message on client2
    const tick = await waitForMessage(client2, 'tick', 1000);
    expect(tick.elapsedTime).toBeGreaterThan(0);

    client1.close();
    client2.close();
  });

  test('new client receives current state on connect', async () => {
    const teamId = createTeamInDb('Late Join Team', ['Jack']);

    // Client 1 starts a timer
    const { ws: client1 } = await connectWebSocket(teamId);
    const speaker = { id: crypto.randomUUID(), name: 'Jack' };
    await sendAndWaitForState(client1, { type: 'start', speaker });

    // Wait a bit for elapsed time
    await new Promise(resolve => setTimeout(resolve, 200));

    // Client 2 connects late and should receive current running state
    const { ws: client2, initialState } = await connectWebSocket(teamId);

    expect(initialState.status).toBe('running');
    expect(initialState.currentSpeaker.name).toBe('Jack');
    expect(initialState.elapsedTime).toBeGreaterThan(0);

    client1.close();
    client2.close();
  });

  test('client disconnect does not affect other clients', async () => {
    const teamId = createTeamInDb('Disconnect Team', ['Kate']);

    const { ws: client1 } = await connectWebSocket(teamId);
    const { ws: client2 } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Kate' };
    await sendAndWaitForState(client1, { type: 'start', speaker });

    // Client 1 disconnects
    client1.close();

    // Client 2 should still work
    await new Promise(resolve => setTimeout(resolve, 100));

    const state = await sendAndWaitForState(client2, { type: 'getState' });
    expect(state.status).toBe('running');

    client2.close();
  });
});

test.describe('Sync Notes', () => {
  test('add_note mints a standupId and broadcasts the note', async () => {
    const teamId = createTeamInDb('Notes Team');
    const { ws } = await connectWebSocket(teamId);

    ws.send(JSON.stringify({ type: 'add_note', text: 'Discuss deploy plan' }));
    const notes = await waitForMessage(ws, 'notes');

    expect(notes.standupId).toBeTruthy();
    expect(notes.syncNotes).toHaveLength(1);
    expect(notes.syncNotes[0].text).toBe('Discuss deploy plan');
    expect(notes.syncNotes[0].id).toBeTruthy();

    ws.close();
  });

  test('a note added before standup keeps its standupId once a speaker starts', async () => {
    const teamId = createTeamInDb('Notes Reuse Team', ['Alice']);
    const { ws } = await connectWebSocket(teamId);

    ws.send(JSON.stringify({ type: 'add_note', text: 'Pre-standup topic' }));
    const notes = await waitForMessage(ws, 'notes');
    const noteStandupId = notes.standupId;

    const speaker = { id: crypto.randomUUID(), name: 'Alice' };
    const state = await sendAndWaitForState(ws, { type: 'start', speaker });

    expect(state.standupId).toBe(noteStandupId);
    expect(state.syncNotes).toHaveLength(1);

    ws.close();
  });

  test('remove_note removes the note and broadcasts the update', async () => {
    const teamId = createTeamInDb('Notes Remove Team');
    const { ws } = await connectWebSocket(teamId);

    ws.send(JSON.stringify({ type: 'add_note', text: 'Temporary note' }));
    const added = await waitForMessage(ws, 'notes');
    const noteId = added.syncNotes[0].id;

    ws.send(JSON.stringify({ type: 'remove_note', id: noteId }));
    const removed = await waitForMessage(ws, 'notes');

    expect(removed.syncNotes).toHaveLength(0);

    ws.close();
  });

  test('blank notes are ignored', async () => {
    const teamId = createTeamInDb('Blank Notes Team', ['Bob']);
    const { ws } = await connectWebSocket(teamId);

    // A blank note should not broadcast; a real one immediately after should be the first.
    ws.send(JSON.stringify({ type: 'add_note', text: '   ' }));
    ws.send(JSON.stringify({ type: 'add_note', text: 'Real note' }));
    const notes = await waitForMessage(ws, 'notes');

    expect(notes.syncNotes).toHaveLength(1);
    expect(notes.syncNotes[0].text).toBe('Real note');

    ws.close();
  });

  test('stop broadcasts end_standup with the captured notes then clears them', async () => {
    const teamId = createTeamInDb('Notes End Team', ['Carol']);
    const { ws } = await connectWebSocket(teamId);

    const speaker = { id: crypto.randomUUID(), name: 'Carol' };
    const startState = await sendAndWaitForState(ws, { type: 'start', speaker });
    const standupId = startState.standupId;

    ws.send(JSON.stringify({ type: 'add_note', text: 'Follow up offline' }));
    await waitForMessage(ws, 'notes');

    const endMsgPromise = waitForMessage(ws, 'end_standup');
    const stateMsgPromise = waitForMessage(ws, 'state');
    ws.send(JSON.stringify({ type: 'stop' }));

    const endMsg = await endMsgPromise;
    expect(endMsg.standupId).toBe(standupId);
    expect(endMsg.syncNotes).toHaveLength(1);
    expect(endMsg.syncNotes[0].text).toBe('Follow up offline');

    const stoppedState = await stateMsgPromise;
    expect(stoppedState.syncNotes).toHaveLength(0);

    ws.close();
  });

  test('notes are broadcast to all connected clients', async () => {
    const teamId = createTeamInDb('Notes Multi-Client Team');
    const { ws: client1 } = await connectWebSocket(teamId);
    const { ws: client2 } = await connectWebSocket(teamId);

    const notesPromise = waitForMessage(client2, 'notes');
    client1.send(JSON.stringify({ type: 'add_note', text: 'Shared topic' }));

    const notes = await notesPromise;
    expect(notes.syncNotes).toHaveLength(1);
    expect(notes.syncNotes[0].text).toBe('Shared topic');

    client1.close();
    client2.close();
  });
});

test.describe('Team Isolation', () => {
  test('different teams have independent timer states', async () => {
    const teamId1 = createTeamInDb('Team Alpha', ['Alice']);
    const teamId2 = createTeamInDb('Team Beta', ['Bob']);

    const { ws: wsTeam1 } = await connectWebSocket(teamId1);
    const { ws: wsTeam2 } = await connectWebSocket(teamId2);

    // Start timer on team 1
    const alice = { id: crypto.randomUUID(), name: 'Alice' };
    await sendAndWaitForState(wsTeam1, { type: 'start', speaker: alice });

    // Team 2 should still be idle
    const team2State = await sendAndWaitForState(wsTeam2, { type: 'getState' });
    expect(team2State.status).toBe('idle');

    wsTeam1.close();
    wsTeam2.close();
  });
});

test.describe('Sprint Rollover on Standup Start', () => {
  const DAY = 24 * 60 * 60 * 1000;

  // A YYYY-MM-DD date n days before today (local midnight), matching how the
  // server anchors sprint windows.
  function daysAgoISO(n: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // The behavior we're locking: a long-lived client (wall display / sidebar)
  // can sit open across a sprint boundary with no one reloading at midnight.
  // Starting a standup must push fresh sprint status so its banner rolls over.
  test('start pushes current-window sprint status to connected clients', async () => {
    const teamId = createTeamInDb('Rollover Team', ['Alice']);

    // 14-day cadence anchored 20 days ago => "now" sits in the SECOND window
    // [day-6, day+8). The goal was marked done 15 days ago, inside the FIRST
    // window, so it must NOT count as done for the current one.
    const db = new Database(TEST_DB_PATH);
    db.prepare(
      'UPDATE teams SET sprint_goal = ?, sprint_start = ?, sprint_length_days = 14, sprint_goal_done_at = ? WHERE id = ?'
    ).run('Carryover goal', daysAgoISO(20), Date.now() - 15 * DAY, teamId);
    db.close();

    const { ws } = await connectWebSocket(teamId);

    // Starting a standup should trigger a 'sprint' broadcast alongside 'state'.
    const sprintPromise = waitForMessage(ws, 'sprint');
    ws.send(JSON.stringify({ type: 'start', speaker: { id: crypto.randomUUID(), name: 'Alice' } }));
    const sprint = (await sprintPromise).sprint as {
      configured: boolean; hasGoal: boolean; done: boolean; daysRemaining: number;
    };

    expect(sprint.configured).toBe(true);
    expect(sprint.hasGoal).toBe(true);
    // Rolled into the current window: the prior window's done flag is cleared...
    expect(sprint.done).toBe(false);
    // ...and days-remaining reflects the current window, not the expired one
    // (which would have read 0).
    expect(sprint.daysRemaining).toBeGreaterThan(0);
    expect(sprint.daysRemaining).toBeLessThanOrEqual(14);

    ws.close();
  });
});
