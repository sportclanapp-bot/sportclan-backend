/** SC-326: integration tests hit the LIVE backend over HTTP. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // SC-431: load .env so SC_RATE_LIMIT_BYPASS reaches the integration suites.
  // Without this the variable is simply absent during a jest run and the bypass
  // header is never sent — which is also the safe default.
  setupFiles: ['dotenv/config'],
  testTimeout: 90000,
};
