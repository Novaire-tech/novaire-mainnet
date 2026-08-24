# Build from the repo root so this image can see packages/bindings and prisma/,
# both of which the indexer imports outside its own directory:
#   docker build -f apps/indexer/Dockerfile -t novaire-indexer .
#
# Required at runtime (docker run -e / --env-file / platform secrets — never baked
# into the image): DATABASE_URL, RPC_URL, NETWORK ("testnet" or "mainnet").
FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Workspace package manifests only, for better layer caching on dependency installs.
# packages/bindings/* are plain source directories (not npm workspaces — they're
# imported by relative path, see snapshotter.ts), so only apps/indexer needs its
# own manifest copied here.
COPY package.json package-lock.json ./
COPY apps/indexer/package.json apps/indexer/package.json

RUN npm ci --workspace=indexer --include-workspace-root

COPY prisma ./prisma
RUN npx prisma generate --schema=prisma/schema.prisma

COPY apps/indexer ./apps/indexer
COPY packages/bindings ./packages/bindings
COPY apps/web/src/config/deployments.testnet.json apps/web/src/config/deployments.testnet.json
COPY apps/web/src/config/deployments.mainnet.json apps/web/src/config/deployments.mainnet.json

WORKDIR /repo/apps/indexer
CMD ["npx", "tsx", "src/index.ts"]
