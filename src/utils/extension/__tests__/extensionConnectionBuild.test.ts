import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { originErrors, originExtensionConnection } from './extensionConnectionBaseline';

// Class: a removed production diagnostic must leave getters, coercion and
// failure handling untouched after the provider has passed discovery.
const script = String.raw`
  import assert from 'node:assert/strict';
  import { readFileSync } from 'node:fs';
  import { createContext, SourceTextModule } from 'node:vm';
  import { build, loadConfigFromFile } from 'vite';

  const mode = process.argv[1];
  const baseline = JSON.parse(readFileSync(0, 'utf8'));
  const network = { expectedChainId: '0x301825', genesisHash: '0x' + 'a'.repeat(64) };
  const account = 'Q' + 'a'.repeat(128);
  const fixtureId = 'virtual:connection-diagnostic-fixture';

  for (const target of ['web', 'desktop', 'embedded']) {
    if (target === 'desktop') process.env.VITE_DESKTOP = '1';
    else delete process.env.VITE_DESKTOP;
    const outcomes = [];
    for (const original of [true, false]) {
      const loaded = await loadConfigFromFile(
        { command: 'build', mode },
        target === 'embedded' ? 'config/vite.config.embedded.ts' : 'config/vite.config.ts'
      );
      const config = loaded.config;
      const result = await build({
        ...config, configFile: false, mode, logLevel: 'silent',
        define: { ...config.define, __QRL_WALLET_PROFILE__: JSON.stringify('v3-private') },
        plugins: [
          // This fixture emits JS in memory. The HTML packager operates on
          // files on disk and is exercised by the complete embedded gate.
          ...config.plugins.filter(plugin => plugin.name !== 'embedded-single-file'),
          {
          name: 'connection-diagnostic-fixture',
          configResolved(config) {
            // Keep the actual compiler policy; this JS fixture has one entry.
            config.build.rolldownOptions.output.manualChunks = undefined;
          },
          resolveId: id => id === fixtureId ? id : undefined,
          load(id) {
            if (id === fixtureId) return [
              'import { connectWithProvider, discoverQrlProviders } from "/src/utils/extension/extensionConnection.ts";',
              'globalThis.connect = connectWithProvider; globalThis.discover = discoverQrlProviders;',
            ].join('\n');
            if (id.endsWith('/src/utils/extension/extensionConnection.ts') && original) return baseline.connection;
            if (id.endsWith('/src/utils/errors.ts') && original) return baseline.errors;
            if (id.endsWith('/src/config/index.ts')) return 'export const QRL_PROVIDER = { TEST_NET_V3: ' + JSON.stringify(network) + ' };';
          },
        }],
        build: {
          ...config.build,
          write: false, copyPublicDir: false, modulePreload: false,
          rolldownOptions: {
            ...config.build.rolldownOptions,
            input: fixtureId,
            output: { ...config.build.rolldownOptions.output, codeSplitting: false },
          },
        },
      });
      const code = result.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
      const cases = [];
      for (const shape of ['plain', 'own-getter', 'inherited-getter', 'proxy', 'expired-name', 'expired-info', 'expired-proxy']) {
        for (const response of ['accounts', 'empty', 'invalid', 'rejected', 'method-error', 'request-error', 'activation-error']) {
          const events = [], timers = new Map();
          let timer = 0, discovered = false;
          const window = new EventTarget();
          const context = createContext({
            window, Event, CustomEvent, URL, TextEncoder, TextDecoder, Uint8Array, Buffer,
            console: Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => {
              events.push(['diagnostic', level, ...args.map(value => value?.message ?? value)]);
            }])),
            alert: message => events.push(['alert', message]),
            setTimeout: (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; },
            clearTimeout: id => timers.delete(id),
          });
          const module = new SourceTextModule(code, {
            context,
            initializeImportMeta(meta) { meta.url = 'https://fixture.invalid/connection.js'; },
          });
          await module.link(() => { throw new Error('Unexpected external module'); });
          await module.evaluate();
          const name = () => {
            events.push(['read-name']);
            if (discovered && (shape === 'expired-name' || shape === 'expired-proxy')) throw new Error('name unavailable');
            return 'Fixture wallet';
          };
          const info = { uuid: 'fixture', rdns: 'com.qrlwallet.extension', icon: 'data:', name: 'Fixture wallet' };
          if (shape === 'own-getter' || shape === 'expired-name') Object.defineProperty(info, 'name', { get: name });
          if (shape === 'inherited-getter') {
            delete info.name;
            Object.setPrototypeOf(info, Object.defineProperty({}, 'name', { get: name }));
          }
          const provider = { request: ({ method }) => {
            events.push(['request', method]);
            if (method === 'qrl_walletCapabilities') return Promise.resolve({ addressScheme: 'qip55-64', chainId: network.expectedChainId, genesisHash: network.genesisHash });
            if (method === 'qrl_chainId') return Promise.resolve(network.expectedChainId);
            if (method === 'qrl_getBlockByNumber') return Promise.resolve({ number: '0x0', hash: network.genesisHash });
            assert.equal(method, 'qrl_requestAccounts');
            if (response === 'rejected') return Promise.reject({ code: 4001, message: 'rejected' });
            if (response === 'method-error') return Promise.reject({ code: -32601, message: 'missing method' });
            if (response === 'request-error') return Promise.reject(new Error('request failed'));
            return Promise.resolve(response === 'empty' ? [] : response === 'invalid' ? [false] : [account]);
          } };
          const detail = { info, provider };
          if (shape === 'proxy' || shape === 'expired-proxy') detail.info = new Proxy(info, {
            get: (value, key) => key === 'name' ? name() : Reflect.get(value, key),
          });
          if (shape === 'expired-info') Object.defineProperty(detail, 'info', { get() {
            events.push(['read-info']);
            if (discovered) throw new Error('info unavailable');
            return info;
          } });
          window.addEventListener('eip6963:requestProvider', () => {
            window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
          });
          const discovering = context.discover();
          for (const [id, scheduled] of [...timers].sort((a, b) => a[1].delay - b[1].delay)) {
            timers.delete(id);
            scheduled.fn();
          }
          const found = await discovering;
          assert.equal(found.length, 1);
          discovered = true;
          events.length = 0;
          const returned = await context.connect(found[0], (address, source) => {
            events.push(['activate', address, source]);
            return response === 'activation-error' ? Promise.reject(new Error('activation failed')) : Promise.resolve();
          }, value => events.push(['provider', value === null ? null : value === provider]));
          assert.equal(timers.size, 0);
          assert.deepEqual(events.filter(event => event[0] === 'request').slice(0, 3), [
            ['request', 'qrl_walletCapabilities'], ['request', 'qrl_chainId'], ['request', 'qrl_getBlockByNumber'],
          ]);
          if (mode === 'production') {
            assert.equal(events.some(event => ['read-name', 'read-info', 'diagnostic'].includes(event[0])), false, shape);
            if (response === 'accounts') assert.equal(JSON.stringify(returned), JSON.stringify([account]), shape);
          }
          cases.push({ shape, response, returned, events });
        }
      }
      outcomes.push(JSON.stringify(cases));
    }
    assert.equal(outcomes[0], outcomes[1], target);
  }
  process.stdout.write('connection-diagnostics: OK\n');
`;

it.each(['production', 'development', 'staging'])(
  'matches origin/dev discovery, qualification and connection in %s builds',
  (mode) => {
    expect(
      execFileSync(
        process.execPath,
        ['--experimental-vm-modules', '--input-type=module', '--eval', script, mode],
        {
          cwd: resolve(__dirname, '../../../..'),
          env: { ...process.env, VITE_SEED: '', NODE_ENV: 'production' },
          input: JSON.stringify({ connection: originExtensionConnection, errors: originErrors }),
          encoding: 'utf8',
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024,
        }
      )
    ).toMatch(/connection-diagnostics: OK\n$/);
  },
  65_000
);
