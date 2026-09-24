/**
 * Single Jest config for the repo's pure unit tests: the post-quantum signing
 * module (`src/utils/signing/__tests__`), the content-moderation helpers
 * (`src/utils/moderation`), and the dApp-connect logic (qrUri parser, desktop
 * bridge sanitiser, dappConnectStore with the service seam mocked). React
 * component coverage stays with Vite/Vitest.
 *
 * All suites run under the node environment (no DOM needed). `@noble/*` and
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
  // Suites are named `*.test.*` / `*.spec.*` only, so a `__tests__`
  // directory can also hold shared helpers (e.g. the NFT tests' fake
  // router history) without jest collecting them as empty suites.
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@noble|@theqrl)/)'],
};
