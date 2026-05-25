#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-5077}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
EXTERNAL_PORT="${EXTERNAL_PORT:-5076}"
DATA_FOLDER="${DATA_FOLDER:-/config}"

UI_FRONTEND_URL="${UI_FRONTEND_URL:-http://127.0.0.1:${EXTERNAL_PORT}}"
UI_CORS_ALLOWED_ORIGINS="${UI_CORS_ALLOWED_ORIGINS:-${UI_FRONTEND_URL}}"
UI_PRODUCTION_MODE="${UI_PRODUCTION_MODE:-false}"
STARTUP_WAIT_SECONDS="${STARTUP_WAIT_SECONDS:-90}"

mkdir -p "${DATA_FOLDER}"

java ${JAVA_OPTS:-} \
  -Dui.frontend-url="${UI_FRONTEND_URL}" \
  -Dui.cors.allowed-origins="${UI_CORS_ALLOWED_ORIGINS}" \
  -Dui.production-mode="${UI_PRODUCTION_MODE}" \
  -jar /app/backend/app.jar \
  --port="${BACKEND_PORT}" \
  --host=127.0.0.1 \
  --datafolder="${DATA_FOLDER}" \
  directstart &
backend_pid=$!

cd /app/frontend
npm run start -- --port "${FRONTEND_PORT}" --hostname 127.0.0.1 &
frontend_pid=$!

wait_for_http() {
  local url="$1"
  local name="$2"
  local deadline=$((SECONDS + STARTUP_WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    if curl --silent --fail --max-time 2 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${name} at ${url}" >&2
  return 1
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local name="$3"
  local deadline=$((SECONDS + STARTUP_WAIT_SECONDS))
  while (( SECONDS < deadline )); do
    if (exec 3<>"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
      exec 3<&-
      exec 3>&-
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${name} on ${host}:${port}" >&2
  return 1
}

wait_for_port "127.0.0.1" "${BACKEND_PORT}" "backend socket"
wait_for_http "http://127.0.0.1:${BACKEND_PORT}/actuator/health" "backend"

node /app/ingress/ingress-server.mjs &
ingress_pid=$!
wait_for_http "http://127.0.0.1:${EXTERNAL_PORT}/actuator/health" "ingress"
wait_for_http "http://127.0.0.1:${FRONTEND_PORT}/" "frontend"

cleanup() {
  kill "${backend_pid}" "${frontend_pid}" "${ingress_pid}" 2>/dev/null || true
  wait || true
}

trap cleanup INT TERM

wait -n "${backend_pid}" "${frontend_pid}" "${ingress_pid}"
exit_code=$?
cleanup
exit "${exit_code}"
