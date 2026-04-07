# CLAUDE.md - MyQRLWallet Frontend

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**MyQRLWallet Frontend** is a modern React web wallet for the QRL blockchain.

- **URL**: https://qrlwallet.com
- **Technologies**: Vite 7, React 19, TypeScript, MobX, TailwindCSS 4, Shadcn/ui
- **Features**: Account management, PIN authentication, ERC20/QRC20 token creation, multi-network support, native mobile app integration

## Related Projects

This frontend is part of the MyQRLWallet ecosystem:
- **myqrlwallet-backend** - Express.js API (RPC proxy, support email, tx history)
- **myqrlwallet-app** - React Native/Expo mobile app wrapper
- **QuantaPool** - Liquid staking protocol

## Current Deployments

- **Token Factory Contract**: `Qa5a330ce8d19f9f906baf6e8255beb2aeb2c1d73`
- **Deployer**: `Q2019EA08f4e24201B98f9154906Da4b924A04892`
- **Production API**: https://qrlwallet.com/api

## Development Commands

```bash
npm install
npm run dev         # Localhost (127.0.0.1:5173)
npm run dev:lan     # LAN access (0.0.0.0:5173)
npm run build       # TypeScript check + production build
npm run lint        # ESLint with zero warnings policy
npm test            # Jest tests
```

## Environment Configuration

Create `.env` from `.env.example`:
- `VITE_RPC_URL_*`: QRL blockchain RPC endpoints
- `VITE_SERVER_URL_*`: Backend API endpoints
- `VITE_CUSTOMERC20FACTORY_ADDRESS`: Token factory contract address
- `VITE_DEPLOYER`: Account that deployed the factory
- `VITE_SEED`: Deployer seed (development only)

## Architecture

### State Management (MobX)
- **qrlStore**: Core blockchain state, wallet functionality, transaction handling
- **settingsStore**: User preferences and application settings
- Singleton pattern with HMR persistence in `stores/store.ts`

### File Structure
```
src/
├── abi/                    # Contract ABIs
├── components/
│   ├── NativeAppBridge.tsx # Mobile app message handler
│   ├── SEO/                # Meta tags
│   ├── UI/                 # Shadcn/ui components
│   └── Core/
│       ├── Header/         # Logo, NavBar, AccountBadge
│       ├── Body/           # Feature pages:
│       │   ├── AccountList/    # Wallet accounts
│       │   ├── AccountDetails/ # Account view
│       │   ├── Transfer/       # Send transactions
│       │   ├── Tokens/         # Token management
│       │   ├── CreateToken/    # ERC20 factory
│       │   ├── ImportAccount/  # Mnemonic/hex import
│       │   ├── Settings/       # App settings
│       │   └── Support/        # Contact form
│       └── Footer/
├── config/                 # Network configuration
├── constants/              # Token lists, chains
├── hooks/                  # React hooks
├── router/                 # React Router config
├── stores/                 # MobX stores
└── utils/
    ├── crypto/             # Encryption utilities
    ├── extension/          # Wallet extension detection
    ├── formatting/         # Address/number formatting
    ├── storage/            # localStorage helpers
    ├── web3/               # Blockchain utilities
    └── nativeApp.ts        # Mobile app bridge
```

## Mobile App Integration

The web wallet detects when running inside the native app via User-Agent containing "MyQRLWallet".

### Bridge Files
- `src/utils/nativeApp.ts` - Detection, messaging, PIN storage
- `src/components/NativeAppBridge.tsx` - Message listener

### Key Bridge Messages
**Web → Native:** `SCAN_QR`, `COPY_TO_CLIPBOARD`, `SHARE`, `TX_CONFIRMED`, `LOG`, `OPEN_URL`, `HAPTIC`, `SEED_STORED`, `REQUEST_BIOMETRIC_UNLOCK`, `WALLET_CLEARED`, `PIN_VERIFIED`, `PIN_CHANGED`, `OPEN_NATIVE_SETTINGS`, `WEB_APP_READY`

**Native → Web:** `QR_RESULT`, `QR_CANCELLED`, `BIOMETRIC_SUCCESS`, `APP_STATE`, `CLIPBOARD_SUCCESS`, `SHARE_SUCCESS`, `ERROR`, `UNLOCK_WITH_PIN`, `RESTORE_SEED`, `CLEAR_WALLET`, `VERIFY_PIN`, `CHANGE_PIN`, `BIOMETRIC_SETUP_PROMPT`

## Key Features

1. **Account Management**: Import via mnemonic/hex seed or connect extension wallets
2. **Token Support**: ERC20/QRC20 token creation via factory contract, token discovery via Explorer API
3. **PIN Security**: Encrypted seed storage with PIN authentication
4. **Multi-Network**: Testnet, Mainnet, and custom RPC support
5. **Native App Support**: Conditional UI and bridge messaging when in mobile app

## Security Considerations

- Never store private keys or seeds in code
- PIN authentication required for all transactions from imported accounts
- Extension wallets handle their own signing
- All sensitive data encrypted in localStorage with expiration
