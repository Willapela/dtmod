#!/usr/bin/env bash
# ============================================================
# DTunnel - instalador do servidor (roda DENTRO do servidor)
# ============================================================
#  Uso:
#     tar xzf dtunnel-server.tar.gz && cd dtunnel-server
#     ./install.sh [host] [porta_grpc] [porta_painel] [senha_painel] [tls]
#
#  Argumentos (opcionais):
#     host         IP/dominio do servidor (padrao: IP publico detectado)
#     porta_grpc   porta do gRPC (padrao 8443)
#     porta_painel porta do painel web (padrao 4000)
#     senha_painel senha do painel (padrao "admin")
#     tls          1 = so TLS, 0 = so h2c (plaintext), auto = os dois na
#                  MESMA porta (padrao). "auto" e' o recomendado: o app
#                  funciona compilado com OU sem certificado.
#
#  O script:
#     1. instala as dependencias (npm)
#     2. gera/usa a CA, o certificado TLS e a chave de assinatura dos replies
#     3. libera as portas no firewall
#     4. sobe o gRPC e o painel web
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# ── argumentos ──────────────────────────────────────────────
HOST="${1:-}"
GRPC_PORT="${2:-8443}"
PANEL_PORT="${3:-4000}"
PANEL_PASS="${4:-admin}"
DT_TLS="${5:-auto}"          # 1 = TLS, 0 = h2c, auto = ambos na mesma porta
REGEN_REPLY_KEY="${REGEN_REPLY_KEY:-0}"

if [ -z "$HOST" ]; then
  HOST="$(curl -s --max-time 8 https://api.ipify.org 2>/dev/null || true)"
  [ -z "$HOST" ] && HOST="$(hostname -I | awk '{print $1}')"
fi

KEYS_DIR="$HERE/keys"
DATA_DIR="$HERE/data"

# ── 1/4 dependencias ─────────────────────────────────────────
echo "=== 1/4 dependencias ==="
if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] node nao esta instalado. Instale o Node.js 18+ primeiro."
  exit 1
fi
npm --version >/dev/null 2>&1 || { echo "[ERRO] npm nao encontrado"; exit 1; }
echo "  node $(node -v)  |  npm $(npm --version)"

if [ ! -d node_modules ]; then
  echo "  instalando as dependencias (npm install)..."
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1 || true
fi
[ -d node_modules ] && echo "  [+] node_modules pronto" || echo "  [!] npm install falhou - o painel pode nao subir"

# ── 2/4 chaves e certificados ────────────────────────────────
echo ""
echo "=== 2/4 chaves e certificados ==="
mkdir -p "$KEYS_DIR"

# A chave de assinatura dos replies (server_reply.key) e UNICA por
# instalacao: se varias pessoas usarem a mesma chave, o reply assinado por
# um servidor seria aceito pelos outros. Por isso, na primeira instalacao a
# chave que veio no pacote e REGENERADA (e o APK tem que ser recompilado
# com a publica nova - veja sync_keys.sh + make_mod.sh).
if [ ! -f "$KEYS_DIR/server_reply.key" ] || [ "$REGEN_REPLY_KEY" = "1" ]; then
  echo "[*] gerando um par de chaves de assinatura NOVO (so nesta maquina)"
  rm -f "$KEYS_DIR/server_reply.key" "$KEYS_DIR/server_reply_key.json"
else
  echo "[*] reusando o par de chaves que ja existe neste servidor"
  echo "    (use REGEN_REPLY_KEY=1 ./install.sh ... para gerar um par novo)"
fi

DT_TLS="$DT_TLS" KEYS_DIR="$KEYS_DIR" bash "$HERE/gen_keys.sh" "$HOST" "$GRPC_PORT"

# ── 3/4 firewall ────────────────────────────────────────────
echo ""
echo "=== 3/4 firewall ==="
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$GRPC_PORT"/tcp  >/dev/null 2>&1 && echo "[+] ufw: $GRPC_PORT/tcp liberado"
  ufw allow "$PANEL_PORT"/tcp >/dev/null 2>&1 && echo "[+] ufw: $PANEL_PORT/tcp liberado"
else
  echo "[*] ufw inativo ou indisponivel - pulei"
fi

# ── 4/4 subir o servidor ─────────────────────────────────────
echo ""
echo "=== 4/4 subindo o servidor ==="
export DT_SERVER_DIR="$KEYS_DIR"
export DT_DATA_DIR="$DATA_DIR"
export GRPC_PORT DT_PANEL_PORT="$PANEL_PORT" DT_PANEL_PASSWORD="$PANEL_PASS"
export DT_TLS DT_LOG_FILE="${DT_LOG_FILE:-/tmp/dtunnel-server.log}"

started=0
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "dtunnel.service"; then
  systemctl daemon-reload 2>/dev/null || true
  systemctl restart dtunnel 2>/dev/null || systemctl start dtunnel 2>/dev/null || true
  sleep 3
  if systemctl is-active --quiet dtunnel 2>/dev/null; then
    echo "[+] dtunnel.service ativo (sobe sozinho no boot)"
    started=1
  fi
fi

if [ "$started" != "1" ]; then
  # sem systemd: sobe com nohup (o start.sh faz exatamente isso)
  if [ -f "$HERE/start.sh" ]; then
    GRPC_PORT="$GRPC_PORT" DT_PANEL_PORT="$PANEL_PORT" DT_PANEL_PASSWORD="$PANEL_PASS" \
      DT_TLS="$DT_TLS" bash "$HERE/start.sh" && started=1
  fi
  if [ "$started" != "1" ]; then
    echo "[!] nao consegui subir o servidor. Rode manualmente:"
    echo "      cd $HERE && GRPC_PORT=$GRPC_PORT DT_PANEL_PORT=$PANEL_PORT \\"
    echo "        DT_PANEL_PASSWORD='$PANEL_PASS' DT_TLS=$DT_TLS ./start.sh"
    exit 1
  fi
fi

echo ""
echo "=============================================="
echo "  DTunnel pronto!"
echo ""
echo "    gRPC  : $HOST:$GRPC_PORT   (modo TLS: $DT_TLS)"
echo "    Painel: http://$HOST:$PANEL_PORT  (user: panel / pass: $PANEL_PASS)"
echo "    Logs  : ${DT_LOG_FILE}"
echo ""
echo "  Proximo passo: apontar o app para este servidor"
echo "    (no pacote dtunnel-mod):"
echo "      SSHPASS='<senha do servidor>' ./sync_keys.sh $HOST root"
echo "      ./make_mod.sh $HOST $GRPC_PORT"
echo "=============================================="
