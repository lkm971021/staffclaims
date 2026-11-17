# Production image: web app + worker share this image (different start commands).
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
ENV NODE_ENV=production TZ=Asia/Kuala_Lumpur PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && useradd -m -u 1001 app && mkdir -p /data/storage && chown -R app /data
COPY --from=build /app /app
USER app
EXPOSE 3000
# Applies pending database migrations, then starts the web server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p ${PORT}"]
