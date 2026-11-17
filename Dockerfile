# Production image (Google Cloud Run, Railway/Render, or docker compose).
# Cloud Run sets PORT=8080 automatically.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Kuala_Lumpur PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 app && mkdir -p /data/storage && chown -R app /data
COPY --from=build --chown=app /app /app
USER app
EXPOSE 3000
# Applies pending database migrations (unless RUN_MIGRATIONS=0), then starts the web server.
CMD ["sh", "-c", "if [ \"${RUN_MIGRATIONS:-1}\" != \"0\" ]; then npx prisma migrate deploy; fi && exec npx next start -p ${PORT}"]
