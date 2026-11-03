# client/Dockerfile — development_guide.md §9.2. Build từ gốc repo: docker build -f client/Dockerfile .
# Image chỉ phục vụ file tĩnh (non-root, cổng 8080); TLS + proxy /api, /socket.io nằm ở nginx biên (§9.3).

# ---- build: vite build + quét secret trong bundle (AC-105) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY client/package.json client/
RUN npm ci -w client -w packages/shared --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY client client
COPY scripts/check-bundle-secrets.mjs scripts/
RUN npm run build -w client && node scripts/check-bundle-secrets.mjs

# ---- runtime: nginx không chạy bằng root ----
FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 8080
