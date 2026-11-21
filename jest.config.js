/** SC-326: integration tests talk to a backend over HTTP: the LOCAL one by default (Q9: seed it with
 *  scripts/seed-local-integration.mjs); live only with SC_BASE + SC_LIVE=1 (src/__tests__/targetBase.ts). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // SC-431: load .env so SC_RATE_LIMIT_BYPASS reaches the integration suites.
  // Without this the variable is simply absent during a jest run and the bypass
  // header is never sent — which is also the safe default.
  setupFiles: ['dotenv/config'],
  // expo-server-sdk v7 is pure ESM; ts-jest (CommonJS) cannot parse it. Map it
  // to a small stand-in so suites that import notify.ts still load. Production
  // reaches the real SDK through a dynamic import in utils/expoPush.ts.
  moduleNameMapper: { '^expo-server-sdk$': '<rootDir>/__mocks__/expo-server-sdk.ts' },
  testTimeout: 90000,
};
