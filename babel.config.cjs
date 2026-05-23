/**
 * Babel config consumed by babel-jest to transpile both the signing module
 * and the ESM-only post-quantum deps (`@noble/hashes`, `@theqrl/*`) down to
 * CommonJS for Jest's node runtime. Vite handles the production build on
 * its own and never touches this file.
 */
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
};
