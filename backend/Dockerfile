FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json bun.lockb tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM oven/bun:1

# Install mosquitto for mosquitto_passwd utility + docker CLI for HUP reload
RUN apt-get update && apt-get install -y --no-install-recommends mosquitto curl ca-certificates && \
    ARCH=$(uname -m) && \
    curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-27.3.1.tgz" \
      | tar -xz --strip-components=1 -C /usr/local/bin docker/docker && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
