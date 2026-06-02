/**
 * Single Jest config for the repo's pure unit tests: the post-quantum signing
 * module (`src/utils/signing/__tests__`) and the content-moderation helpers
 * (`src/utils/moderation`). React component coverage stays with Vite/Vitest.
 *
 * Both suites run under the node environment (no DOM needed). `@noble/*` and
 * `@theqrl/*` ship ESM with `.js`-extension imports, so they must be
 * transformed by babel-jest (the transformIgnorePatterns carve-out) rather
 * than left as raw ESM for jest's CommonJS runtime.
 *
 * NOTE: there used to be a second `jest.config.mjs`; two implicit configs make
 * `jest` abort ("Multiple configurations found"). Keep exactly one.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.dapp-example-cache/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@noble|@theqrl)/)'],
};
