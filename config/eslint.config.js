import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'build', 'coverage', '*.config.js', '*.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
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
      // Wire input is `unknown` narrowed by runtime guards; hand-written
      // assertions are the laundering this rule forbids. `as const` stays legal.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      // Double assertions erase the type system.
      // Narrow honestly (e.g. annotate WebCrypto buffers as
      // Uint8Array<ArrayBuffer>, or assert once from `unknown`).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSAsExpression > TSAsExpression',
          message:
            'Double type assertion (e.g. `x as unknown as T`) is banned: it bypasses the type checker. Narrow honestly or assert once from `unknown`.',
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
          // Use `patterns`/`group` (not `paths`) for every entry so deep
          // subpath imports are covered too (e.g. `@theqrl/wallet.js/dist/...`),
          // not just the bare specifier. This keeps the boundary enforced by
          // the rule itself rather than relying on each package's exports map.
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
      // Defensive runtime validation of typed parameters is deliberate for wire
      // input; do not flag those checks as dead.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Counters and sizes in messages are idiomatic; the lossy stringifications stay banned.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-console': 'off', // Allow console for debugging in development
      'react-hooks/exhaustive-deps': 'warn', // Keep as warning for now
    },
  },
  {
    // The crypto boundary itself: these modules ARE the encapsulation layer,
    // so they are the only place allowed to import the raw primitives. This
    // intentionally lifts only `no-restricted-imports` (the primitive ban);
    // the `no-restricted-syntax` double-assertion ban stays in force here.
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
    // Tests exercise malformed input and mock internals; assertions and loose
    // typing are legitimate tools there.
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
    },
  },
  {
    // Files outside the app tsconfig (build config, public service worker) keep
    // the syntactic rules; type-aware rules need a program that includes them.
    files: ['config/**/*.ts', 'public/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // RATCHET: hardened-TypeScript rules (strict-type-checked, no type assertions)
    // are on for the whole project. The files below predate them and still
    // trip the rules switched off here. Fix a file, then delete its line. New
    // files are never added to this list; the dApp-connect slice
    // (src/services/dappConnect, src/components/Core/Body/DAppConnect) passes
    // the full rule set with no override.
    files: [
      'config/vite.config.embedded.ts',
      'src/App.tsx',
      'src/components/Core/Body/AccountList/AccountBalance/AccountBalance.tsx',
      'src/components/Core/Body/AccountList/ActiveAccount/ActiveAccount.tsx',
      'src/components/Core/Body/AccountList/ActiveAccount/TransactionHistoryPopup.tsx',
      'src/components/Core/Body/AccountList/CopyAddressButton/CopyAddressButton.tsx',
      'src/components/Core/Body/AccountList/OtherAccounts/OtherAccounts.tsx',
      'src/components/Core/Body/AddressBook/AddressBook.tsx',
      'src/components/Core/Body/AddressBook/AddressBookPicker.tsx',
      'src/components/Core/Body/CreateAccount/AccountCreationForm/AccountCreationForm.tsx',
      'src/components/Core/Body/CreateAccount/CreateAccount.tsx',
      'src/components/Core/Body/CreateAccount/MnemonicDisplay/MnemonicDisplay.tsx',
      'src/components/Core/Body/CreateToken/CreateToken.tsx',
      'src/components/Core/Body/CreateToken/TokenCreationForm/TokenCreationForm.tsx',
      'src/components/Core/Body/CreateToken/TokenStatus.tsx',
      'src/components/Core/Body/Home/AccountCreateImport/AccountCreateImport.tsx',
      'src/components/Core/Body/Home/AccountCreateImport/ActiveAccountDisplay/ActiveAccountDisplay.tsx',
      'src/components/Core/Body/Home/AccountCreateImport/ExtensionPickerDialog.tsx',
      'src/components/Core/Body/Home/AccountCreateImport/MobilePairingDialog.tsx',
      'src/components/Core/Body/Home/ConnectionFailed/ConnectionFailed.tsx',
      'src/components/Core/Body/Home/DecorativeAccountVideo.tsx',
      'src/components/Core/Body/Home/Home.tsx',
      'src/components/Core/Body/Home/ReceivePopup.tsx',
      'src/components/Core/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess.tsx',
      'src/components/Core/Body/ImportAccount/ImportAccount.tsx',
      'src/components/Core/Body/ImportAccount/ImportAccountForm/ImportAccountForm.tsx',
      'src/components/Core/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet.tsx',
      'src/components/Core/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm.tsx',
      'src/components/Core/Body/Nfts/AddNftModal.tsx',
      'src/components/Core/Body/Nfts/NftCard.tsx',
      'src/components/Core/Body/Nfts/NftCollectionRow.tsx',
      'src/components/Core/Body/Nfts/NftDetail.tsx',
      'src/components/Core/Body/Nfts/NftGallery.tsx',
      'src/components/Core/Body/Nfts/NftImage.tsx',
      'src/components/Core/Body/Nfts/nftNavigation.ts',
      'src/components/Core/Body/PinSetup/DeviceCredentialRecovery.tsx',
      'src/components/Core/Body/PinSetup/PinSetup.tsx',
      'src/components/Core/Body/QRView/QRView.tsx',
      'src/components/Core/Body/Settings/ExportWalletFile.tsx',
      'src/components/Core/Body/Settings/NetworkSettings/NetworkSettings.tsx',
      'src/components/Core/Body/Settings/Settings.tsx',
      'src/components/Core/Body/Tokens/AddTokenModal/AddTokenModal.tsx',
      'src/components/Core/Body/Tokens/TokenForm/TokenForm.tsx',
      'src/components/Core/Body/Tokens/TokenForm/columns.tsx',
      'src/components/Core/Body/Tokens/TokenForm/data-table.tsx',
      'src/components/Core/Body/TransactionHistory/TransactionHistory.tsx',
      'src/components/Core/Body/Transfer/GasFeeNotice/GasFeeNotice.tsx',
      'src/components/Core/Body/Transfer/TransactionSuccessful/TransactionSuccessful.tsx',
      'src/components/Core/Body/Transfer/Transfer.tsx',
      'src/components/Core/Layout/MobileNav.tsx',
      'src/components/Core/Layout/app-sidebar.tsx',
      'src/components/Core/MyQRLWallet.tsx',
      'src/components/Core/RouteMonitor/RouteMonitor.tsx',
      'src/components/NativeAppBridge.tsx',
      'src/components/Telegram/TelegramControlCenter.tsx',
      'src/components/UI/AddressDisclosure.tsx',
      'src/components/UI/CheckBox.tsx',
      'src/components/UI/Dialog.tsx',
      'src/components/UI/DropdownMenu.tsx',
      'src/components/UI/Form.tsx',
      'src/components/UI/Label.tsx',
      'src/components/UI/NavigationMenu.tsx',
      'src/components/UI/PinInput/PinInput.tsx',
      'src/components/UI/Select.tsx',
      'src/components/UI/Separator.tsx',
      'src/components/UI/Slider.tsx',
      'src/components/UI/Tabs.tsx',
      'src/components/UI/Tooltip.tsx',
      'src/components/UI/sheet.tsx',
      'src/components/UI/sidebar.tsx',
      'src/components/UI/switch.tsx',
      'src/config/deploymentProfile.ts',
      'src/config/networks.ts',
      'src/config/runtimeProfile.ts',
      'src/desktop/bridge.ts',
      'src/hooks/use-mobile.tsx',
      'src/hooks/useCopyToClipboard.ts',
      'src/hooks/useNetworkQrnsRecipient.ts',
      'src/hooks/useWalletLimit.ts',
      'src/router/router.tsx',
      'src/stores/nftStore.ts',
      'src/stores/qrlStore.ts',
      'src/stores/tokenStore.ts',
      'src/utils/addressBook.ts',
      'src/utils/crypto/cryptoWorkerClient.ts',
      'src/utils/crypto/deviceCredential.ts',
      'src/utils/crypto/keystoreBackup.ts',
      'src/utils/crypto/pinAttemptTracker.ts',
      'src/utils/crypto/storedSeed.ts',
      'src/utils/crypto/walletEncryption.ts',
      'src/utils/embeddedMigration.ts',
      'src/utils/embeddedRuntime.ts',
      'src/utils/errors.ts',
      'src/utils/formatting/balance.ts',
      'src/utils/formatting/string.ts',
      'src/utils/logout.ts',
      'src/utils/mobileConnect/mobileConnection.ts',
      'src/utils/nativeApp.ts',
      'src/utils/nativeWalletMutation.ts',
      'src/utils/navigation.ts',
      'src/utils/signing/typedData.ts',
      'src/utils/storage/autoLock.ts',
      'src/utils/storage/storage.ts',
      'src/utils/useBackDismiss.ts',
      'src/utils/walletEpoch.ts',
      'src/utils/web3/contractFactory.ts',
      'src/utils/web3/nft.ts',
      'src/utils/web3/nftDiscovery.ts',
      'src/utils/web3/qrns.ts',
      'src/utils/web3/tokenDiscovery.ts',
      'src/utils/web3/vm64Logs.ts',
    ],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
    },
  },
)
