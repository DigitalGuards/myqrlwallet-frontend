import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'build', 'coverage', '*.config.js', '*.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
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
      'react-refresh/only-export-components': 'off', // Allow exporting utilities with components

      // --- Hardened TypeScript: mandate no type laundering ---------------
      // The @theqrl/web3 ABI typing gap is handled honestly in
      // src/utils/web3/contractFactory.ts (single assertions from `unknown`
      // to the library's own ContractAbi + hand-written method interfaces),
      // so there is no sanctioned `any` escape hatch anywhere in the app.
      '@typescript-eslint/no-explicit-any': 'error',
      // No `expr!` — prove non-nullness with a guard or resolve a typed value.
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
      // No `@ts-ignore` / `@ts-nocheck`; `@ts-expect-error` only with a real reason.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      // No `x as unknown as T` — double assertions erase the type system.
      // Narrow honestly (e.g. annotate WebCrypto buffers as
      // Uint8Array<ArrayBuffer>, or assert once from `unknown`).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression',
          message:
            'Double type assertion (`x as unknown as T`) is banned: it bypasses the type checker. Narrow honestly or assert once from `unknown`.',
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
          paths: [
            {
              name: '@theqrl/mldsa87',
              message:
                'ML-DSA-87 primitives are encapsulated in src/utils/signing. Import the signing wrappers (signMessage/signTypedData/verify) instead.',
            },
            {
              name: '@theqrl/wallet.js',
              message:
                'ML-DSA-87 key/seed derivation is encapsulated in src/utils/crypto and src/utils/signing. Import getHexSeedFromMnemonic/deriveHexSeedAsync/etc instead.',
            },
          ],
          patterns: [
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
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-console': 'off', // Allow console for debugging in development
      'react-hooks/exhaustive-deps': 'warn', // Keep as warning for now
    },
  },
  {
    // The crypto boundary itself: these modules ARE the encapsulation layer,
    // so they are the only place allowed to import the raw primitives.
    files: [
      'src/utils/crypto/**/*.{ts,tsx}',
      'src/utils/signing/**/*.{ts,tsx}',
      'src/services/dappConnect/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
)
