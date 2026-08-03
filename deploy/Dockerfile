# MyQRLWallet Frontend - Multi-stage Docker Build
# Stage 1: Build the React/Vite application
FROM node:22.22-alpine@sha256:e58326d0d441090181ac150dc2078d3e2cf6a0d42e809aebba3ef5880935ffdd AS builder

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
# Note: --legacy-peer-deps needed for React 19 compatibility with some packages
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build arguments for Vite environment variables (must be set at build time)
ARG VITE_RPC_URL_PRODUCTION=https://qrlwallet.com/api/qrl-rpc
ARG VITE_SERVER_URL_PRODUCTION=https://qrlwallet.com/api
ARG VITE_EXPLORER_URL_PRODUCTION=https://zondscan.com
ARG VITE_CUSTOMERC20FACTORY_ADDRESS
ARG VITE_DEPLOYER

ENV VITE_RPC_URL_PRODUCTION=$VITE_RPC_URL_PRODUCTION \
    VITE_SERVER_URL_PRODUCTION=$VITE_SERVER_URL_PRODUCTION \
    VITE_EXPLORER_URL_PRODUCTION=$VITE_EXPLORER_URL_PRODUCTION

# Build the application
RUN npm run build

# Stage 2: Serve with unprivileged nginx (runs as non-root on port 8080)
FROM nginxinc/nginx-unprivileged:alpine@sha256:a6c3ec0c0d249d68b0682df854d4a9e222b90fb607dc3fcf2f1d2fcbc85d347e

# Copy custom nginx config
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 8080 (unprivileged)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8080/health || exit 1

# Start nginx (runs as non-root user nginx, UID 101)
CMD ["nginx", "-g", "daemon off;"]
