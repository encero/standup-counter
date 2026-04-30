/**
 * WebSocket Behavior Tests
 * Tests real-time timer sync, start/pause/resume/stop, multi-client synchronization
 */
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { BASE_URL, generateTeamId, TEST_DB_PATH } from './test-helpers';
import Database from 'better-sqlite3';

const WS_BASE = 'ws://localhost:3001';

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
function connectWebSocket(teamId: string): Promise<{ ws: WebSocket; initialState: any }> {
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
function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type} message`)), timeout);
    
    const handler = (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (err) {
        // Ignore parse errors
      }
    };
    
    ws.on('message', handler);
  });
}

// Helper to send a message and wait for state response
async function sendAndWaitForState(ws: WebSocket, message: object): Promise<any> {
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
      ws.on('close', (code, reason) => {
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
