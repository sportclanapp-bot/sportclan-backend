/** SC-326: integration tests hit the LIVE backend over HTTP. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 90000,
};
