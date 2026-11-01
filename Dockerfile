FROM node:22-alpine

WORKDIR /app

# Copy dependency definitions and install
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose Ponder's default GraphQL API port
EXPOSE 42069

# Liveness: /health returns 200 as soon as the HTTP server is up, even during
# backfill. (/ready is 503 until historical sync finishes; use it for load
# balancer readiness, not here.) node:22-alpine has busybox wget, no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:42069/health || exit 1

# Production mode (no hot reload). Override with `npm run dev` for local work.
CMD ["npm", "run", "start"]
