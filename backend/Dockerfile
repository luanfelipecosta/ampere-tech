FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb tsconfig.json ./
RUN bun install --frozen-lockfile
COPY src ./src
RUN bun run build

FROM node:20-alpine
RUN apk add --no-cache mosquitto
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts=false
COPY --from=builder /app/dist ./dist
EXPOSE 4001
CMD ["node", "dist/index.js"]
