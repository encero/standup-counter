/**
 * Global teardown for Playwright tests
 * Stops server and cleans up test database
 */
import { stopServer, cleanupTestDatabase } from './test-helpers';

async function globalTeardown() {
  console.log('\n🧹 Cleaning up test environment...');
  
  await stopServer();
  console.log('✅ Server stopped');
  
  cleanupTestDatabase();
  console.log('✅ Test database cleaned up\n');
}

export default globalTeardown;
