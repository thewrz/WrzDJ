# WrzDJ StageLinQ Bridge Dockerfile
#
# NOTE: This container must run with network_mode: host (or --network host)
# for StageLinQ UDP broadcast discovery to work.

FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production=false

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Run the bridge
CMD ["node", "dist/index.js"]
