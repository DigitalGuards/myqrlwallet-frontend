# Zond Web Wallet

A modern, secure web wallet for the Quantum Resistant Ledger's Zond blockchain. This wallet provides a user-friendly interface for interacting with QRL's next-generation blockchain, featuring quantum-resistant security.

## Overview

The Zond Web Wallet is designed to provide secure and intuitive access to the QRL Zond blockchain. Built with modern web technologies, it offers a seamless experience for managing your quantum-resistant accounts.

### Key Features

- 🛡️ **Quantum-Resistant Security**: Built on QRL's post-quantum cryptography
- 🔐 **Secure Account Management**: Create and import accounts with mnemonic phrase backup
- 🌐 **Multi-Network Support**: Connect to Testnet or Local Node
- 🎨 **Modern Interface**: Clean, intuitive design with dark mode
- 📱 **Responsive Design**: Works seamlessly across all devices
- ⚡ **Fast & Lightweight**: Built with performance in mind

## Getting Started

### Prerequisites

- Node.js 16.x or later
- npm 7.x or later

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/DigitalGuards/zondwebwallet.git
cd zondwebwallet
```

2. Install dependencies:
```bash
cd webapp
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Visit http://localhost:5173 in your browser

## Technology Stack

- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS
- **State Management**: MobX
- **Routing**: React Router v6
- **Blockchain Integration**: @theqrl/web3
- **Development Server**: Node.js/Express

## Project Structure

```
zondwebwallet/
├── webapp/                # Frontend application
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── stores/       # MobX state management
│   │   ├── functions/    # Utility functions
│   │   └── configuration/# Config files
│   └── public/           # Static assets
└── backend/              # API server
```

## Available Networks

- **Testnet**: Development and testing network
- **Local Node**: For local development and testing

## Security Features

- Secure mnemonic phrase generation
- Client-side transaction signing
- No private key storage
- Secure connection handling

## Links

- [QRL Website](https://www.theqrl.org/)
- [QRL Documentation](https://docs.theqrl.org/)
- [Twitter](https://x.com/DigitalGuards)
- [GitHub Repository](https://github.com/DigitalGuards/zondwebwallet/)

## Development

### Building for Production

```bash
npm run build
```

The production build will be available in the `dist` directory.

### Deployment

The application can be served using the included nginx configuration:

1. Copy the build files to your server
2. Use the provided nginx.conf for proper routing and security headers
3. Enable HTTPS (required for security)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
