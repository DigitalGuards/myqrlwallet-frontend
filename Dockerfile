# MyQRLWallet Frontend - Multi-stage Docker Build
# Stage 1: Build the React/Vite application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
# Note: --legacy-peer-deps needed for React 19 compatibility with some packages
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build arguments for Vite environment variables (must be set at build time)
ARG VITE_RPC_URL_TESTNET
ARG VITE_RPC_URL_MAINNET
ARG VITE_SERVER_URL_TESTNET
ARG VITE_SERVER_URL_MAINNET
ARG VITE_CUSTOMERC20FACTORY_ADDRESS
ARG VITE_DEPLOYER

# Build the application
RUN npm run build

# Stage 2: Serve with unprivileged nginx (runs as non-root on port 8080)
FROM nginxinc/nginx-unprivileged:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 8080 (unprivileged)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/health || exit 1

# Start nginx (runs as non-root user nginx, UID 101)
CMD ["nginx", "-g", "daemon off;"]
