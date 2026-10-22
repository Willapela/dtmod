#!/usr/bin/env bash
# Sobe o servidor DTunnel (gRPC + painel). Reinicie com: ./start.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
# Mata QUALQUER instancia anterior do servidor. O padrao 'node src/index.js'
# nao casa com o processo real ('node /caminho/absoluto/src/index.js') e o
# servidor antigo continuava segurando a porta -> EADDRINUSE.
pkill -f 'dtunnel-server/src/index.js' 2>/dev/null
pkill -f 'node src/index.js' 2>/dev/null
# e libera as portas (sniffer + TLS interno + h2c interno)
for p in "$GRPC_PORT" $((GRPC_PORT + 100)) $((GRPC_PORT + 200)); do
  fuser -k -n tcp "$p" >/dev/null 2>&1 || true
done
sleep 1
export DT_SERVER_DIR="$HERE/keys"
export DT_DATA_DIR="$HERE/data"
export GRPC_PORT="${GRPC_PORT:-8443}"
export DT_PANEL_PORT="${DT_PANEL_PORT:-4000}"
export DT_PANEL_PASSWORD="${DT_PANEL_PASSWORD:-dtunnel}"
export DT_LOG_FILE="${DT_LOG_FILE:-/tmp/dtunnel-server.log}"
# auto = aceita TLS e h2c na MESMA porta (o app pode ser compilado
# com ou sem certificado)
export DT_TLS="${DT_TLS:-auto}"
: > "$DT_LOG_FILE"

# porta privilegiada sem root: usa authbind se existir
LAUNCH=(node src/index.js)
if [[ "${GRPC_PORT}" -lt 1024 ]] && [[ "$(id -u)" != "0" ]] && command -v authbind >/dev/null 2>&1; then
  LAUNCH=(authbind node src/index.js)
  echo "[*] usando authbind para a porta ${GRPC_PORT}"
fi

setsid nohup "${LAUNCH[@]}" >> "$DT_LOG_FILE" 2>&1 < /dev/null &
disown
sleep 4
if ! grep -qE "gRPC (TLS|PLAINTEXT|AUTO)" "$DT_LOG_FILE" 2>/dev/null; then
  echo "[ERRO] o servidor nao subiu:"
  tail -15 "$DT_LOG_FILE"
  exit 1
fi
ss -tlnp | grep -E ':(${GRPC_PORT}|${PANEL_PORT})' || true
head -6 "$DT_LOG_FILE"
