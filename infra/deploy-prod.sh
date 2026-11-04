#!/usr/bin/env bash
# infra/deploy-prod.sh — chạy TRÊN VM (development_guide.md §9.6), được workflow cicd-docker gọi qua SSH:
#   bash infra/deploy-prod.sh <DEPLOY_PATH>
# Yêu cầu: infra/.env.prod và server/.env.prod đã ghi (workflow ghi từ GitHub Secrets, umask 077).
# Idempotent: chạy lại bao nhiêu lần cũng được. Không in secret; không bật `set -x`.
#
# Các bước:
#   1. Kiểm tra Docker Engine + Compose v2 và quyền truy cập daemon của user SSH.
#   2. pull image.
#   3. Bảo đảm infra/mongo/keyfile hợp lệ (§9.3). Thiếu file → bind mount của Docker tự tạo THƯ MỤC rỗng →
#      mongod thoát ngay → "dependency failed to start: container hustalo-prod-mongo-1 is unhealthy".
#      mongod (uid 999 trong image mongo) còn từ chối keyfile có quyền group/other hoặc không đọc được.
#   4. Chọn cấu hình nginx: có chứng chỉ Let's Encrypt (/etc/letsencrypt/live/hustalo) → nginx.conf (80 + 443);
#      chưa có → nginx.bootstrap.conf (chỉ cổng 80 phục vụ ACME HTTP-01) để lấy chứng chỉ lần đầu (§9.6).
#   5. up -d --wait, rồi tạo index (idempotent).
#   Lỗi bất kỳ → in `docker compose ps` + log ngắn của các service để chẩn đoán.
#
# In ra một dòng `HUSTALO_TLS=ready|bootstrap` để workflow biết TLS đã sẵn sàng hay chưa.
set -euo pipefail

DEPLOY_PATH="${1:?Cách dùng: deploy-prod.sh <DEPLOY_PATH>}"
cd "$DEPLOY_PATH"

COMPOSE=(docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml)
MONGO_IMAGE=mongo:7.0
NGINX_IMAGE=nginx:alpine
CERT_DIR=/etc/letsencrypt/live/hustalo

err() { printf '::error::%s\n' "$*"; }

diagnose() {
  echo '::group::Chẩn đoán docker compose (ps + log 60 dòng cuối)'
  "${COMPOSE[@]}" ps -a || true
  "${COMPOSE[@]}" logs --no-color --tail=60 mongo mongo-init redis server nginx || true
  echo '::endgroup::'
}

# ---- 1. Docker ----
if ! command -v docker >/dev/null 2>&1; then
  err "VM chưa cài Docker Engine (development_guide.md §9.1)"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  err "User $(id -un) không truy cập được Docker daemon — chạy: sudo usermod -aG docker $(id -un) rồi đăng nhập SSH lại"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  err "Thiếu Docker Compose v2 (plugin 'docker compose')"
  exit 1
fi
for f in infra/.env.prod server/.env.prod infra/docker-compose.prod.yml infra/mongo/init-prod.js; do
  [ -s "$f" ] || { err "Thiếu hoặc rỗng: $DEPLOY_PATH/$f"; exit 1; }
done

on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then diagnose; fi
  exit "$rc"
}
trap on_exit EXIT

# ---- 2. Image ----
"${COMPOSE[@]}" pull --quiet

# ---- 3. Keyfile MongoDB ----
# Chạy trong container root (image mongo đã pull) để chown 999:999 mà không cần sudo trên VM.
# Keyfile cũ hợp lệ được giữ nguyên nội dung, chỉ sửa owner/quyền.
docker run --rm --user 0 --entrypoint bash -v "$DEPLOY_PATH/infra/mongo:/k" "$MONGO_IMAGE" -euc '
  if [ -d /k/keyfile ]; then
    rmdir /k/keyfile || { echo "::error::infra/mongo/keyfile là thư mục không rỗng — xóa tay rồi deploy lại"; exit 1; }
    echo "[deploy] xóa thư mục rỗng infra/mongo/keyfile (do bind mount tạo khi thiếu file)"
  fi
  if [ ! -s /k/keyfile ]; then
    # 756 byte ngẫu nhiên → 1008 ký tự base64 (mongod chấp nhận 6–1024 ký tự base64)
    head -c 756 /dev/urandom | base64 -w 0 > /k/keyfile
    echo "[deploy] tạo mới infra/mongo/keyfile"
  fi
  chown 999:999 /k/keyfile
  chmod 400 /k/keyfile
'

# ---- 4. TLS / nginx ----
if docker run --rm --entrypoint sh -v /etc/letsencrypt:/etc/letsencrypt:ro "$NGINX_IMAGE" \
  -c "test -s $CERT_DIR/fullchain.pem && test -s $CERT_DIR/privkey.pem"; then
  export NGINX_CONF=nginx.conf
  tls=ready
else
  export NGINX_CONF=nginx.bootstrap.conf
  tls=bootstrap
  printf '::warning::%s\n' "Chưa có chứng chỉ $CERT_DIR — nginx chạy cấu hình bootstrap (chỉ HTTP/ACME). Lấy chứng chỉ một lần trên VM theo development_guide.md §9.6 rồi chạy lại workflow."
fi

# ---- 5. Up + index ----
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 --remove-orphans
"${COMPOSE[@]}" exec -T server node dist/infra/db/indexes.js

echo "HUSTALO_TLS=$tls"
