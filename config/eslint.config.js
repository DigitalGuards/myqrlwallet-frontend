import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import { fileURLToPath } from 'node:url'

export const strictFiles = ['**/*.{ts,tsx}']

export const baseConfig = tseslint.config(
  { ignores: ['dist', 'node_modules', 'build', 'coverage', '*.config.js', '*.config.ts'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      // The automatic JSX runtime supplies React without an in-scope import.
      react.configs.flat['jsx-runtime'],
    ],
    files: strictFiles,
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          // Build tooling uses the default type-aware project.
          allowDefaultProject: [
            'config/vite.config.ts',
            'config/vite.config.embedded.ts',
          ],
        },
        tsconfigRootDir: fileURLToPath(new URL('..', import.meta.url)),
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react': react,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'error',

      // --- Hardened TypeScript: mandate no type laundering ---------------
      // Wire input stays unknown until runtime guards establish its type.
      '@typescript-eslint/no-explicit-any': 'error',
      // Prove non-nullness with a guard or resolve a typed value.
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Pairs with tsconfig `verbatimModuleSyntax`: type-only imports must use
      // `import type` so the emitter never has to guess what is value vs type.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          // Allow `typeof import('...')` annotations: they type the heavy
          // lazily/dynamically-imported modules (web3, socket.io) without
          // pulling them into the static graph. verbatimModuleSyntax permits them.
          disallowTypeAnnotations: false,
        },
      ],
      // TypeScript errors must be resolved at their source.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': true,
        },
      ],
      // Wire input is `unknown` narrowed by runtime guards; hand-written
      // assertions are the laundering this rule forbids. `as const` stays legal.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      // Double assertions erase the type system.
      // Narrow unknown input with runtime guards.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression',
          message:
            'Double type assertions are banned. Narrow unknown input with a guard.',
        },
      ],
      // -------------------------------------------------------------------

      // --- Crypto encapsulation boundary --------------------------------
      // Raw post-quantum / hashing primitives must live ONLY inside the
      // crypto modules (src/utils/crypto, src/utils/signing,
      // src/services/dappConnect), which is also where the future go-qrllib
      // WASM swap will land. App code (stores, components) must consume the
      // typed wrappers those modules export, never the primitives directly.
      // The crypto modules themselves re-enable these imports via the
      // override block below.
      'no-restricted-imports': [
        'error',
        {
          // Patterns cover each package and all of its subpath imports.
          patterns: [
            {
              group: ['@theqrl/mldsa87', '@theqrl/mldsa87/*'],
              message:
                'ML-DSA-87 primitives are encapsulated in src/utils/signing. Import the signing wrappers (signMessage/signTypedData/verify) instead.',
            },
            {
              group: ['@theqrl/wallet.js', '@theqrl/wallet.js/*'],
              message:
                'ML-DSA-87 key/seed derivation is encapsulated in src/utils/crypto and src/utils/signing. Import getHexSeedFromMnemonic/deriveHexSeedAsync/etc instead.',
            },
            {
              group: ['@noble/hashes', '@noble/hashes/*'],
              message:
                'SHAKE/SHA3 hashing is encapsulated in src/utils/signing (messageDigest/typedData). Import the digest helpers instead.',
            },
            {
              group: ['@noble/post-quantum', '@noble/post-quantum/*'],
              message:
                'ML-KEM-768 is encapsulated in src/services/dappConnect/PQCrypto. Import the PQCrypto helpers instead.',
            },
            {
              group: ['hash-wasm', 'hash-wasm/*'],
              message:
                'Argon2id is encapsulated in src/utils/crypto (argon2/keystoreBackup). Import decryptKeystoreAsync/parseKeystoreBackup instead.',
            },
          ],
        },
      ],
      // -------------------------------------------------------------------

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Counters and sizes in messages are idiomatic; the lossy stringifications stay banned.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // TypeScript types every prop in these files.
      'react/prop-types': 'off',
      'no-console': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Crypto modules are the designated boundary for raw primitive imports.
    files: [
      'src/utils/crypto/**/*.{ts,tsx}',
      'src/utils/signing/**/*.{ts,tsx}',
      'src/services/dappConnect/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // Build tooling runs in Node at build time and never ships in the wallet;
    // printing to the terminal is how it reports.
    files: ['config/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // The logger is the single module allowed to write to the console; every
    // other module logs through it. Console calls still listed in the ratchet
    // below are debt that their slices move onto the logger.
    files: ['src/utils/log.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/test-utils/malformed.ts'],
    rules: {
      // Malformed test fixtures use this single assertion boundary.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'as' }],
    },
  },
)

// Existing lint debt, including tests. Entries may only be removed.
// Regenerate with npm run lint:ratchet:update after fixing a file/rule pair.
// BEGIN LINT RATCHET
export const lintRatchet = [
  {
    files: ["src/utils/formatting/__tests__/address.test.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-template-expression": "off",
    },
  },
  {
    files: [
      "src/utils/mobileConnect/__tests__/mobileConnection.security.test.ts",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/mobileConnect/mobileConnection.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/storage/__tests__/seedRevision.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/utils/storage/autoLock.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/storage/storage.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/web3/contractFactory.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
    },
  },
  {
    files: ["src/utils/web3/nft.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/web3/nftDiscovery.ts"],
    rules: {
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/web3/qrns.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/utils/web3/tokenDiscovery.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/web3/vm64Logs.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
];
// END LINT RATCHET

export default [...baseConfig, ...lintRatchet]
