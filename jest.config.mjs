/**
 * Jest is used only for pure unit tests of the post-quantum signing module
 * (`src/utils/signing`). React component coverage stays with the existing
 * Vite/Vitest setup; jsdom is loaded on a per-test basis when needed.
 *
 * `@noble/hashes` and `@theqrl/*` ship ESM-only or dual builds whose mjs
 * variants use `.js` extension imports — both need to be transformed by
 * babel-jest, hence the `transformIgnorePatterns` carve-out.
 */
export default {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.dapp-example-cache/'],
  transform: {
    '^.+\\.tsx?$': 'babel-jest',
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@noble|@theqrl)/)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
