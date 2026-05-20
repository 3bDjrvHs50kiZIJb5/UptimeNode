#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-6038}"

mkdir -p data logs
if [ ! -f data/sites.json ]; then
  cat > data/sites.json <<'JSON'
[]
JSON
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker 命令"
  exit 1
fi

docker compose down --remove-orphans || true
docker compose build
docker compose up -d

echo "服务已启动：http://127.0.0.1:${PORT}"
