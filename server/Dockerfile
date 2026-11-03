# server/Dockerfile — development_guide.md §9.2. Build từ gốc repo: docker build -f server/Dockerfile .
# argon2 0.45 có prebuild linux-x64 musl (prebuilds/linux-x64/argon2.musl.node) → dùng được node:22-alpine,
# không cần toolchain build (đã chạy thử hashPassword/verifyPassword trong image runtime — xem docs/STATUS.md).

# ---- deps: cài dependency của server + shared (kể cả dev, để build) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci -w server -w packages/shared --include-workspace-root

# ---- build: tsup bundle server + @hustalo/shared → server/dist ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY server server
RUN npm run build -w server

# ---- runtime: chỉ dependency production, chạy non-root ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY server/package.json server/
RUN npm ci --omit=dev -w server --include-workspace-root && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
# Không có file .env nào trong image: env truyền lúc chạy (docker-compose.prod.yml env_file).
CMD ["node", "dist/main.js"]
