# One image runs everything (Next.js console + API + webhooks + Socket.IO + queue worker) on port 3000.
# Build from the repo root: the npm workspace lockfile lives here.

FROM node:22-bookworm-slim AS base
# Prisma's query/schema engines need OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY tools/mock-receiver/package.json tools/mock-receiver/
RUN npm ci --no-audit --no-fund
COPY web web
RUN npx -w web prisma generate \
  && npm run build \
  && npm prune --omit=dev --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1 \
    PATH=/app/node_modules/.bin:$PATH
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/web/package.json /app/web/next.config.ts web/
COPY --from=build --chown=node:node /app/web/prisma web/prisma
COPY --from=build --chown=node:node /app/web/.next web/.next
COPY --from=build --chown=node:node /app/web/dist web/dist
# Media files (mount a persistent volume here).
RUN mkdir -p web/uploads && chown node:node web/uploads
WORKDIR /app/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start (exec so node gets SIGTERM for a clean shutdown).
CMD ["sh", "-c", "prisma migrate deploy && exec node dist/server.js"]
