# Production image: Next.js standalone server + bundled worker (same image, different command).
#   web:    docker run ... socra            (default CMD: node server.js)
#   worker: docker run ... socra node worker-dist/index.mjs
# Migrations: docker run ... socra npx prisma migrate deploy
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build && node scripts/build-worker.mjs

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r socra && useradd -r -g socra socra
# Full node_modules: the worker and `prisma migrate deploy` need packages beyond Next's traced set.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/worker-dist ./worker-dist
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json
USER socra
EXPOSE 3000 3001
CMD ["node", "server.js"]
