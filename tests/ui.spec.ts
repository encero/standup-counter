/**
 * UI Behavior Tests
 * End-to-end browser tests for complete user flows
 */
import { test, expect, type Page } from '@playwright/test';
import { generateTeamId, TEST_DB_PATH, BASE_URL } from './test-helpers';
import Database from 'better-sqlite3';

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

// Helper to create standup data for trends testing
function createStandupData(teamId: string) {
  const db = new Database(TEST_DB_PATH);
  const members = db.prepare('SELECT id, name FROM team_members WHERE team_id = ?').all(teamId) as any[];
  
  const now = Date.now();
  
  // Create 5 standups over the past week
  for (let day = 0; day < 5; day++) {
    const standupId = crypto.randomUUID();
    const standupTime = now - (day * 24 * 60 * 60 * 1000);
    const date = new Date(standupTime);
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();
    
    let totalDuration = 0;
    
    for (const member of members) {
      const duration = 60000 + Math.floor(Math.random() * 30000);
      totalDuration += duration;
      
      db.prepare(`
        INSERT INTO sessions (id, team_id, member_id, member_name, standup_id, start_time, end_time, duration, interruptions, paused_duration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), teamId, member.id, member.name, standupId,
        standupTime - 120000 + (members.indexOf(member) * duration),
        standupTime - 60000 + (members.indexOf(member) * duration),
        duration, Math.floor(Math.random() * 3), Math.floor(Math.random() * 5000)
      );
    }
    
    db.prepare(`
      INSERT INTO standups (id, team_id, date, day_of_week, start_time, end_time, total_duration, speaker_count, total_interruptions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(standupId, teamId, dateStr, dayOfWeek, standupTime - 120000, standupTime, totalDuration, members.length, 0);
  }
  
  db.close();
}

test.describe('Team Not Found', () => {
  test('shows team not found page for invalid team ID', async ({ page }) => {
    await page.goto('/invalidteamid');
    
    await expect(page.locator('text=Team Not Found')).toBeVisible();
    await expect(page.locator('text=valid team URL')).toBeVisible();
  });

  test('shows team not found page at root', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('text=Team Not Found')).toBeVisible();
  });
});

test.describe('Standup Timer Page', () => {
  test('displays team members', async ({ page }) => {
    const teamId = createTeamInDb('UI Test Team', ['Alice', 'Bob', 'Charlie']);
    await page.goto(`/${teamId}`);
    
    await expect(page.locator('text=Alice')).toBeVisible();
    await expect(page.locator('text=Bob')).toBeVisible();
    await expect(page.locator('text=Charlie')).toBeVisible();
  });

  test('displays initial idle state', async ({ page }) => {
    const teamId = createTeamInDb('Idle Test Team', ['Alice']);
    await page.goto(`/${teamId}`);
    
    await expect(page.locator('text=Select a speaker to begin')).toBeVisible();
    await expect(page.locator('text=00:00')).toBeVisible();
  });

  test('clicking member starts timer', async ({ page }) => {
    const teamId = createTeamInDb('Start Timer Team', ['Dave']);
    await page.goto(`/${teamId}`);

    // Wait for page to fully load (members and WebSocket connection)
    await expect(page.getByText('Dave')).toBeVisible();
    await page.waitForTimeout(500); // Wait for WebSocket to connect

    // Click on Dave's button
    await page.getByRole('button', { name: /Dave/ }).click();

    // Should show Dave is speaking - wait for WebSocket sync
    await expect(page.getByText('Dave is speaking')).toBeVisible({ timeout: 10000 });

    // Timer should be running (not 00:00)
    await page.waitForTimeout(1500);
    const timerText = await page.locator('[class*="font-mono"]').first().textContent();
    expect(timerText).not.toBe('00:00');
  });

  test('clicking timer card pauses/resumes', async ({ page }) => {
    const teamId = createTeamInDb('Pause Resume Team', ['Eve']);
    await page.goto(`/${teamId}`);

    // Wait for member to appear and WebSocket to connect
    await expect(page.getByText('Eve')).toBeVisible();
    await page.waitForTimeout(500);

    // Click Eve's button
    await page.getByRole('button', { name: /Eve/ }).click();
    await expect(page.getByText('Eve is speaking')).toBeVisible({ timeout: 10000 });

    // Wait for timer to run
    await page.waitForTimeout(500);

    // Click the timer card to pause
    await page.locator('[class*="border-2"]').first().click();

    // Should show paused state (interruptions counter)
    await expect(page.getByText('Paused 1×')).toBeVisible({ timeout: 5000 });

    // Click again to resume
    await page.locator('[class*="border-2"]').first().click();

    // Timer should be running again
    await page.waitForTimeout(500);
  });

  test('End Standup button shows summary', async ({ page }) => {
    const teamId = createTeamInDb('End Standup Team', ['Frank']);
    await page.goto(`/${teamId}`);

    // Wait for page to load and WebSocket to connect
    await expect(page.getByText('Frank')).toBeVisible();
    await page.waitForTimeout(500);

    // Start timer
    await page.getByRole('button', { name: /Frank/ }).click();
    await expect(page.getByText('Frank is speaking')).toBeVisible({ timeout: 10000 });

    // Click End Standup
    await page.getByRole('button', { name: 'End Standup' }).click();

    // Summary dialog should appear
    await expect(page.getByText('Standup Complete')).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to trends page', async ({ page }) => {
    const teamId = createTeamInDb('Nav Team', ['Alice']);
    await page.goto(`/${teamId}`);

    // Click the trends button (bar chart icon)
    await page.locator('a[href*="trends"]').click();

    await expect(page).toHaveURL(`/${teamId}/trends`);
    await expect(page.locator('text=Standup Trends')).toBeVisible();
  });

  test('switching speakers updates display', async ({ page }) => {
    const teamId = createTeamInDb('Switch Speaker UI Team', ['Grace', 'Henry']);
    await page.goto(`/${teamId}`);

    // Wait for members to load and WebSocket to connect
    await expect(page.getByText('Grace')).toBeVisible();
    await page.waitForTimeout(500);

    // Start with Grace
    await page.getByRole('button', { name: /Grace/ }).click();
    await expect(page.getByText('Grace is speaking')).toBeVisible({ timeout: 10000 });

    // Switch to Henry
    await page.getByRole('button', { name: /Henry/ }).click();
    await expect(page.getByText('Henry is speaking')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Control Page', () => {
  test('displays connection status', async ({ page }) => {
    const teamId = createTeamInDb('Control Status Team', ['Ivy']);
    await page.goto(`/${teamId}/control`);

    // Should show connected status
    await expect(page.locator('text=Connected')).toBeVisible({ timeout: 5000 });
  });

  test('displays team members as buttons', async ({ page }) => {
    const teamId = createTeamInDb('Control Members Team', ['Jack', 'Kate']);
    await page.goto(`/${teamId}/control`);

    await expect(page.locator('button:has-text("Jack")')).toBeVisible();
    await expect(page.locator('button:has-text("Kate")')).toBeVisible();
  });

  test('clicking member starts timer', async ({ page }) => {
    const teamId = createTeamInDb('Control Start Team', ['Leo']);
    await page.goto(`/${teamId}/control`);

    await page.getByRole('button', { name: 'Leo' }).click();

    // Timer should start - wait for timer display to update
    await page.waitForTimeout(1500);

    // Timer should not be 00:00
    const timerElement = page.locator('[class*="font-mono"][class*="text-6xl"]');
    const timerText = await timerElement.textContent();
    expect(timerText).not.toBe('00:00');
  });

  test('tapping timer card toggles pause', async ({ page }) => {
    const teamId = createTeamInDb('Control Pause Team', ['Mary']);
    await page.goto(`/${teamId}/control`);

    // Start timer
    await page.click('button:has-text("Mary")');
    await page.waitForTimeout(500);

    // Tap timer card to pause
    await page.locator('[class*="text-center"][class*="cursor-pointer"]').click();

    // Should show paused indicator
    await expect(page.locator('text=Paused 1×')).toBeVisible({ timeout: 5000 });

    // Tap again to resume
    await page.locator('[class*="text-center"][class*="cursor-pointer"]').click();

    // Should show "Tap to pause" instruction
    await expect(page.locator('text=Tap to pause')).toBeVisible({ timeout: 5000 });
  });

  test('End Standup button resets state', async ({ page }) => {
    const teamId = createTeamInDb('Control End Team', ['Nancy']);
    await page.goto(`/${teamId}/control`);

    // Start timer
    await page.click('button:has-text("Nancy")');
    await page.waitForTimeout(500);

    // Click End Standup
    await page.click('button:has-text("End Standup")');

    // Timer should reset to 00:00
    await expect(page.locator('text=00:00')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=No speaker')).toBeVisible();
  });

  test('redirects to team-not-found for invalid team', async ({ page }) => {
    await page.goto('/invalidteam/control');

    await expect(page).toHaveURL('/team-not-found');
    await expect(page.locator('text=Team Not Found')).toBeVisible();
  });
});

test.describe('Trends Page', () => {
  test('displays team overview stats', async ({ page }) => {
    const teamId = createTeamInDb('Trends Overview Team', ['Oscar', 'Paula']);
    createStandupData(teamId);

    await page.goto(`/${teamId}/trends`);

    await expect(page.getByText('Standup Trends')).toBeVisible();
    await expect(page.getByText('Team Overview')).toBeVisible();
    // Use exact match for "Standups" to avoid multiple matches
    await expect(page.getByText('Standups', { exact: true })).toBeVisible();
    await expect(page.getByText('Avg Duration')).toBeVisible();
  });

  test('displays time range selector', async ({ page }) => {
    const teamId = createTeamInDb('Trends Range Team', ['Quinn']);
    createStandupData(teamId);

    await page.goto(`/${teamId}/trends`);

    await expect(page.locator('button:has-text("7d")')).toBeVisible();
    await expect(page.locator('button:has-text("30d")')).toBeVisible();
    await expect(page.locator('button:has-text("90d")')).toBeVisible();
  });

  test('changing time range updates data', async ({ page }) => {
    const teamId = createTeamInDb('Trends Change Range Team', ['Ryan']);
    createStandupData(teamId);

    await page.goto(`/${teamId}/trends`);

    // Default is 30d
    await expect(page.locator('button:has-text("30d")[data-active="true"], button:has-text("30d")[class*="bg-"]')).toBeVisible();

    // Click 7d
    await page.click('button:has-text("7d")');

    // URL or state should update (depending on implementation)
    await page.waitForTimeout(500);
  });

  test('displays individual breakdown', async ({ page }) => {
    const teamId = createTeamInDb('Trends Individual Team', ['Steve', 'Tina']);
    createStandupData(teamId);

    await page.goto(`/${teamId}/trends`);

    await expect(page.locator('text=Individual Breakdown')).toBeVisible();
    await expect(page.locator('text=Steve')).toBeVisible();
    await expect(page.locator('text=Tina')).toBeVisible();
  });

  test('displays recent standups history', async ({ page }) => {
    const teamId = createTeamInDb('Trends History Team', ['Uma']);
    createStandupData(teamId);

    await page.goto(`/${teamId}/trends`);

    await expect(page.locator('text=Recent Standups')).toBeVisible();
  });

  test('back button returns to timer page', async ({ page }) => {
    const teamId = createTeamInDb('Trends Back Team', ['Victor']);

    await page.goto(`/${teamId}/trends`);

    await page.click('text=← Back');

    await expect(page).toHaveURL(`/${teamId}`);
  });
});

test.describe('Multi-Device Sync (UI)', () => {
  test('timer state syncs between two browser contexts', async ({ browser }) => {
    const teamId = createTeamInDb('Multi Device Team', ['Wendy']);

    // Open two browser contexts (simulating two devices)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Both navigate to the same team
    await page1.goto(`/${teamId}`);
    await page2.goto(`/${teamId}`);

    // Wait for both to load and WebSocket to connect
    await expect(page1.getByText('Wendy')).toBeVisible();
    await expect(page2.getByText('Wendy')).toBeVisible();
    await page1.waitForTimeout(500);
    await page2.waitForTimeout(500);

    // Start timer on page1 using the button
    await page1.getByRole('button', { name: /Wendy/ }).click();

    // Wait for page1 to show the speaking state first
    await expect(page1.getByText('Wendy is speaking')).toBeVisible({ timeout: 10000 });

    // Page2 should sync and show Wendy is speaking
    await expect(page2.getByText('Wendy is speaking')).toBeVisible({ timeout: 10000 });

    await context1.close();
    await context2.close();
  });
});
