# MyQRLWallet

A modern, secure web wallet for the Quantum Resistant Ledger's Zond blockchain. Built with React 19 and featuring quantum-resistant security, mobile app integration, and ERC20/QRC20 token support.

**Live**: [qrlwallet.com](https://qrlwallet.com)

## Features

- **Quantum-Resistant Security** - Built on QRL's post-quantum cryptography (ML-DSA-87/Dilithium)
- **Account Management** - Create accounts, import via mnemonic or hex seed, connect extension wallets
- **PIN Authentication** - Encrypted seed storage with PIN protection
- **Token Support** - Create and manage ERC20/QRC20 tokens via factory contract
- **Token Discovery** - Automatic detection of tokens held by your address
- **Multi-Network** - Testnet, Mainnet, and custom RPC support
- **Mobile App Integration** - Native features when running in [MyQRLWallet App](https://github.com/DigitalGuards/myqrlwallet-app)
- **Responsive Design** - Works on desktop and mobile browsers

## Getting Started

### Prerequisites

- Node.js 18.x or later
- npm 9.x or later

### Installation

```bash
git clone https://github.com/DigitalGuards/myqrlwallet-frontend.git
cd myqrlwallet-frontend
npm install
```

### Configuration

```bash
cp .env.example .env
```

Edit `.env` with your settings:
- `VITE_RPC_URL_*` - Zond blockchain RPC endpoints
- `VITE_SERVER_URL_*` - Backend API endpoints
- `VITE_CUSTOMERC20FACTORY_ADDRESS` - Token factory contract address
- `VITE_DEPLOYER` - Factory deployer account
- `VITE_SEED` - Deployer seed (development only - never commit!)

### Development

```bash
npm run dev         # Localhost (127.0.0.1:5173)
npm run dev:lan     # LAN access (0.0.0.0:5173)
```

### Build

```bash
npm run build       # TypeScript check + production build
npm run preview     # Preview production build
npm run lint        # ESLint with zero warnings policy
npm test            # Run tests
```

## Docker Deployment

### Build Image

```bash
docker build -t myqrlwallet-frontend:latest \
  --build-arg VITE_RPC_URL_TESTNET=https://qrlwallet.com/api/zond-rpc/testnet \
  --build-arg VITE_RPC_URL_MAINNET=https://qrlwallet.com/api/zond-rpc/mainnet \
  --build-arg VITE_SERVER_URL_TESTNET=https://qrlwallet.com/api \
  --build-arg VITE_SERVER_URL_MAINNET=https://qrlwallet.com/api \
  .
```

### Run Container

```bash
docker run -d -p 8080:8080 myqrlwallet-frontend:latest
```

The container:
- Uses `nginx-unprivileged` (runs as non-root, UID 101)
- Serves on port 8080
- Includes health check at `/health`
- Has gzip compression and security headers configured

## Kubernetes Deployment

Kubernetes manifests are provided in the `k8s/` directory.

### Prerequisites

- Kubernetes cluster with nginx-ingress controller
- cert-manager for TLS certificates

### Deploy

```bash
# Apply all manifests
kubectl apply -k k8s/

# Or apply individually
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/certificate.yaml
kubectl apply -f k8s/cluster-issuer.yaml  # Once per cluster
```

### Manifests

| File | Description |
|------|-------------|
| `namespace.yaml` | Creates `myqrlwallet` namespace |
| `deployment.yaml` | 2 replicas with health checks, resource limits |
| `service.yaml` | ClusterIP service (port 80 → 8080) |
| `hpa.yaml` | Horizontal Pod Autoscaler (2-10 replicas) |
| `ingress.yaml` | nginx ingress with TLS, routes `/` and `/api` |
| `certificate.yaml` | Let's Encrypt TLS certificate |
| `cluster-issuer.yaml` | Let's Encrypt ClusterIssuer |

## CI/CD

The GitHub Actions workflow (`.github/workflows/ci.yml`) automatically:

1. **On PR/Push**: Runs lint and build checks
2. **On Push to main/dev**: Builds and pushes Docker image to GitHub Container Registry
3. **On Push to main**: Deploys to Kubernetes cluster

### Image Tags

- `ghcr.io/<owner>/myqrlwallet-frontend:latest` - Latest main branch
- `ghcr.io/<owner>/myqrlwallet-frontend:main-<sha>` - Specific commit
- `ghcr.io/<owner>/myqrlwallet-frontend:dev` - Dev branch

### Required GitHub Configuration

**Variables** (Settings → Secrets and variables → Actions → Variables):
- `VITE_RPC_URL_TESTNET`
- `VITE_RPC_URL_MAINNET`
- `VITE_SERVER_URL_TESTNET`
- `VITE_SERVER_URL_MAINNET`
- `VITE_CUSTOMERC20FACTORY_ADDRESS`
- `VITE_DEPLOYER`

**Secrets**:
- `KUBECONFIG` - Base64-encoded kubeconfig for deployment

## Technology Stack

| Category | Technology |
|----------|------------|
| Framework | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | TailwindCSS 4 + Shadcn/ui |
| State | MobX |
| Routing | React Router 7 |
| Blockchain | @theqrl/web3 |
| Container | nginx-unprivileged (Alpine) |

## Project Structure

```
src/
├── abi/                    # Contract ABIs
├── components/
│   ├── NativeAppBridge.tsx # Mobile app message handler
│   ├── SEO/                # Meta tags
│   ├── UI/                 # Shadcn/ui components
│   └── ZondWallet/
│       ├── Header/         # Logo, NavBar, AccountBadge
│       ├── Body/           # Feature pages
│       │   ├── AccountList/
│       │   ├── AccountDetails/
│       │   ├── Transfer/
│       │   ├── Tokens/
│       │   ├── CreateToken/
│       │   ├── ImportAccount/
│       │   ├── Settings/
│       │   └── Support/
│       └── Footer/
├── config/                 # Network configuration
├── constants/              # Token lists, chains
├── hooks/                  # React hooks
├── router/                 # React Router config
├── stores/                 # MobX stores (zondStore, settingsStore)
└── utils/
    ├── crypto/             # Encryption utilities
    ├── extension/          # Wallet extension detection
    ├── formatting/         # Address/number formatting
    ├── storage/            # localStorage helpers
    ├── web3/               # Blockchain utilities
    └── nativeApp.ts        # Mobile app bridge
```

## Mobile App Integration

When running inside the [MyQRLWallet App](https://github.com/DigitalGuards/myqrlwallet-app), the web wallet detects the native context via User-Agent and enables additional features:

- **QR Scanner** - Native camera for scanning addresses
- **Device Login** - Face ID / Touch ID / PIN / pattern for wallet unlock
- **Auto-Lock** - App locks when backgrounded, requires re-auth on return
- **Haptic Feedback** - Native device vibration
- **Native Share** - System share sheet
- **Secure Storage** - Seeds backed up in device SecureStore (iOS Keychain / Android Keystore)

## Related Projects

- [myqrlwallet-backend](https://github.com/DigitalGuards/myqrlwallet-backend) - API server (RPC proxy, support email, tx history)
- [myqrlwallet-app](https://github.com/DigitalGuards/myqrlwallet-app) - React Native mobile app
- [QuantaPool](https://github.com/DigitalGuards/QuantaPool) - Liquid staking protocol

## Security

- Client-side transaction signing only
- PIN-encrypted seed storage in localStorage
- No private keys sent to server
- Extension wallets handle their own signing
- Automatic session expiration

## Links

- [QRL Website](https://www.theqrl.org/)
- [QRL Documentation](https://docs.theqrl.org/)
- [ZondScan Explorer](https://zondscan.com)
- [Twitter](https://x.com/DigitalGuards)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see LICENSE file for details.
