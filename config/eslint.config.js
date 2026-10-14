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
          // Build tooling and the service worker use the default type-aware project.
          allowDefaultProject: [
            'config/vite.config.ts',
            'config/vite.config.embedded.ts',
            'public/background.ts',
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
    files: ["config/vite.config.embedded.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-console": "off",
    },
  },
  {
    files: ["config/vite.config.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["public/background.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/ImportAccount/__tests__/ImportAccount.activation.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/components/Core/Body/PinSetup/DeviceCredentialRecovery.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/components/Core/Body/PinSetup/PinSetup.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/PinSetup/__tests__/DeviceCredentialRecovery.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/components/Core/Body/QRView/QRView.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/Core/Body/Settings/ExportWalletFile.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "no-console": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/Settings/NetworkSettings/NetworkSettings.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/components/Core/Body/Settings/Settings.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-console": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/TransactionHistory/__tests__/historyNetwork.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/TransactionHistory/__tests__/pendingHistory.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/TransactionHistory/__tests__/v3HistoryNetwork.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/Transfer/TransactionSuccessful/__tests__/TransactionSuccessful.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/Transfer/__tests__/Transfer.qrns.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/Transfer/__tests__/Transfer.sendStatus.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/Core/Body/Transfer/__tests__/Transfer.tokenAddress.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/components/Core/Layout/MobileNav.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: ["src/components/Core/Layout/__tests__/PageShell.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/components/Core/Layout/app-sidebar.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: ["src/components/Core/RouteMonitor/RouteMonitor.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/components/Core/RouteMonitor/__tests__/RouteMonitor.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/components/SEO/__tests__/SEO.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/components/Telegram/TelegramControlCenter.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/components/UI/AddressDisclosure.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/components/UI/Button.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/components/UI/CheckBox.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/Dialog.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/components/UI/DropdownMenu.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/Form.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-template-expression": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/components/UI/Label.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/NavigationMenu.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/components/UI/PinInput/PinInput.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/components/UI/Select.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/Separator.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/Slider.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/Tabs.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/Tooltip.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/UI/__tests__/AddressDisclosure.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/components/UI/__tests__/QrlAddress.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/components/UI/sheet.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/components/UI/sidebar.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/components/UI/switch.tsx"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/components/__tests__/NativeAppBridge.history.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/components/__tests__/pinPrompts.test.tsx"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/__tests__/activeAccountValidation.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/stores/__tests__/dappConnectStore.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/__tests__/extensionRecovery.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/__tests__/nativeTransferFee.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/__tests__/nftCollectionDiscovery.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/__tests__/qrlPriceFetch.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/__tests__/sendHistory.test.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/__tests__/sendStatus.test.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/__tests__/transactionHistoryStore.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/__tests__/v3AssetSigning.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/__tests__/v3WalletProfile.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/__tests__/walletCorrectness.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/dappConnectStore.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/stores/nftStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/stores/store.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/stores/tokenStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/__tests__/clipboardSensitive.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/utils/__tests__/embeddedMigration.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/utils/__tests__/embeddedRuntime.test.ts"],
    rules: {
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  {
    files: ["src/utils/__tests__/embeddedShell.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/utils/__tests__/logout.test.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/utils/__tests__/logoutEmbedded.test.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/__tests__/nativeAppCorrelation.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/utils/__tests__/nativeAppDeviceCredential.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/utils/__tests__/nativeDocumentBinding.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/utils/__tests__/nativeWalletMutation.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/__tests__/walletEpoch.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
    },
  },
  {
    files: ["src/utils/addressBook.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/utils/embeddedMigration.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/embeddedMigrationBoot.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/embeddedRuntime.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/utils/errors.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/utils/extension/__tests__/extensionConnection.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/extension/__tests__/v3Provider.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/extension/extensionConnection.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/formatting/__tests__/address.test.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-template-expression": "off",
    },
  },
  {
    files: ["src/utils/formatting/balance.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/utils/formatting/string.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
  {
    files: ["src/utils/guards.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/utils/log.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/logout.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "no-console": "off",
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
    files: ["src/utils/nativeBack.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/nativeWalletMutation.ts"],
    rules: {
      "@typescript-eslint/only-throw-error": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/navigation.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
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
    files: ["src/utils/useBackDismiss.ts"],
    rules: {
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },
  {
    files: ["src/utils/walletEpoch.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "no-console": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/feePolicy.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/nativeMaxReserve.test.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/nftCollections.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/qip55Composition.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/qrns.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/sendPolling.test.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/utils/web3/__tests__/vm64Logs.test.ts"],
    rules: {
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
