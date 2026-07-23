FROM node:20-alpine

RUN apk add --no-cache python3 make g++ \
 && npm install -g pnpm@9

WORKDIR /app

# Workspace + root manifests
COPY pnpm-workspace.yaml package.json ./

# Per-package manifests (better layer caching)
COPY lib/db/package.json ./lib/db/
COPY artifacts/api-server/package.json ./artifacts/api-server/

# No lockfile is shipped — install fresh (network required at build time)
RUN pnpm install --no-frozen-lockfile

# Now copy the actual source
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

# Build the API server (esbuild bundle)
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
