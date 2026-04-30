/**
 * Global setup for Playwright tests
 * Creates test database and starts server before all tests
 */
import { createTestDatabase, startServer, waitForServer, TEST_DB_PATH, buildFrontend } from './test-helpers';
import Database from 'better-sqlite3';

let db: Database.Database | null = null;

async function globalSetup() {
  console.log('\n📦 Setting up test environment...');

  // Build frontend first
  console.log('🔨 Building frontend...');
  await buildFrontend();
  console.log('✅ Frontend built');

  // Create fresh test database
  db = createTestDatabase();
  console.log(`✅ Test database created at ${TEST_DB_PATH}`);

  // Close database before server starts (server will open its own connection)
  db.close();

  // Start server in production mode
  console.log('🚀 Starting test server...');
  await startServer();
  await waitForServer();
  console.log('✅ Server is ready\n');
}

export default globalSetup;
