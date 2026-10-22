#!/usr/bin/env bash
# Prepara e sobe o servidor DTunnel (Node.js) + painel web.
#
#   ./setup.sh <host> [grpc_porta] [painel_porta] [senha_painel]
#
# IMPORTANTE: este script roda NA MAQUINA ONDE O SERVIDOR DEVE FICAR.
#   - servidor local .......  ./setup.sh 127.0.0.1 8443 4000 senha
#   - servidor remoto ......  use o deploy (copia tudo via scp e reinicia):
#                            ./deploy_node_server.sh MEU_IP 443 4000
#
# Gera as chaves/certificados em ./keys (se ainda nao existirem) e sobe:
#   - gRPC TLS na porta <grpc_porta>  (padrao 443)
#   - painel web na porta <painel_porta> (padrao 4000)
set -euo pipefail

HOST="${1:?uso: setup.sh <host> [grpc_porta] [painel_porta] [senha]}"
GRPC_PORT="${2:-443}"
PANEL_PORT="${3:-4000}"
PANEL_PASS="${4:-dtunnel}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# avisa se o host nao e local (provavelmente o usuario esta no PC cliente)
LOCAL_IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | tr -d '\n')"
# IP publico (NAT) tambem conta como "esta maquina"
PUB_IP="$(curl -s -m 5 https://api.ipify.org 2>/dev/null || true)"
case "$HOST" in
  127.0.0.1|localhost|0.0.0.0) ;;
  *)
    IS_LOCAL=0
    for ip in $LOCAL_IPS $PUB_IP; do
      [ "$ip" = "$HOST" ] && IS_LOCAL=1
    done
    if [[ "$IS_LOCAL" -eq 0 ]]; then
      echo "[!] ATENCAO: ${HOST} nao parece ser um IP desta maquina."
      echo "    IPs locais: ${LOCAL_IPS:-desconhecidos}${PUB_IP:+ | publico: $PUB_IP}"
      echo "    Se o servidor deve rodar em OUTRA maquina, use o deploy:"
      echo "        ./deploy_node_server.sh ${HOST} ${GRPC_PORT} ${PANEL_PORT}"
      echo "    (ele copia tudo via scp, instala as dependencias e reinicia)"
      echo ""
      read -rp "    Continuar mesmo assim? [s/N]: " CONT
      case "$CONT" in
        s|S|y|Y) ;;
        *) echo "[!] abortado."; exit 1 ;;
      esac
    fi
    ;;
esac

echo "=== 1/4 dependencias ==="
if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] node nao encontrado (instale Node.js 18+)"; exit 1
fi
node --version
if [ ! -d node_modules ]; then
  npm install --omit=dev
fi

echo "=== 2/4 chaves e certificados ==="
KEYS_DIR="$HERE/keys" bash "$HERE/gen_keys.sh" "$HOST" "$GRPC_PORT"

echo "=== 3/4 firewall (ufw) ==="
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow ${GRPC_PORT}/tcp  >/dev/null 2>&1 && echo "[+] ufw: ${GRPC_PORT}/tcp liberado"
  ufw allow ${PANEL_PORT}/tcp >/dev/null 2>&1 && echo "[+] ufw: ${PANEL_PORT}/tcp liberado"
fi

echo "=== 3b/4 porta privilegiada (${GRPC_PORT}) ==="
# portas < 1024 exigem root, a capability cap_net_bind_service no binario do
# node, ou o authbind. O script tenta resolver sozinho e, se nao conseguir,
# explica as opcoes.
HIGH_PORT=""
NODE_BIN="$(command -v node)"
if [[ "${GRPC_PORT}" -lt 1024 ]] && [[ "$(id -u)" != "0" ]]; then
  RESOLVED=0
  # 1) capability no node (sudo -n funciona sem pedir senha)
  if sudo -n setcap 'cap_net_bind_service=+ep' "$NODE_BIN" 2>/dev/null; then
    echo "[+] cap_net_bind_service aplicada em $NODE_BIN (roda sem root)"
    RESOLVED=1
  # 2) authbind (se instalado)
  elif command -v authbind >/dev/null 2>&1 && touch /tmp/.authbind_test 2>/dev/null; then
    echo "[+] authbind detectado"
    RESOLVED=1
  fi

  if [[ "$RESOLVED" -eq 0 ]]; then
    echo ""
    echo "[!] A porta ${GRPC_PORT} e privilegiada e exige privilegio extra."
    echo "    Escolha uma opcao:"
    echo ""
    echo "    (a) rodar o setup com sudo (mais simples, so nesta maquina):"
    echo "        sudo ./setup.sh ${HOST} ${GRPC_PORT} ${PANEL_PORT} ${PANEL_PASS}"
    echo ""
    echo "    (b) instalar o authbind e rodar assim (o node nao e alterado):"
    echo "        sudo apt-get install -y authbind"
    echo "        ./setup.sh ${HOST} ${GRPC_PORT} ${PANEL_PORT} ${PANEL_PASS}"
    echo ""
    echo "    (c) capability no node (vale so uma vez):"
    echo "        sudo setcap 'cap_net_bind_service=+ep' ${NODE_BIN}"
    echo "        ./setup.sh ${HOST} ${GRPC_PORT} ${PANEL_PORT} ${PANEL_PASS}"
    echo ""
    echo "    (d) usar uma porta alta (>1024), sem privilegio nenhum:"
    HIGH_PORT=$((GRPC_PORT + 38000))
    echo "        ./setup.sh ${HOST} ${HIGH_PORT} ${PANEL_PORT} ${PANEL_PASS}"
    echo "        (e refaca o APK com a porta nova:  ./make_mod.sh ${HOST} ${HIGH_PORT})"
    echo ""
    read -rp "    Opcao [a/b/c/d]: " OPT
    case "$OPT" in
      a|A)
        echo "[*] reiniciando com sudo..."
        exec sudo "$0" "$HOST" "$GRPC_PORT" "$PANEL_PORT" "$PANEL_PASS"
        ;;
      b|B)
        echo "[*] instalando o authbind..."
        sudo apt-get install -y authbind || { echo "[ERRO] falha ao instalar"; exit 1; }
        ;;
      c|C)
        echo "[*] aplicando capability no node..."
        sudo setcap 'cap_net_bind_service=+ep' "$NODE_BIN" || { echo "[ERRO] falha"; exit 1; }
        ;;
      d|D)
        GRPC_PORT="$HIGH_PORT"
        echo "[+] usando a porta ${GRPC_PORT} (alta, sem privilegio)"
        ;;
      *)
        echo "[ERRO] opcao invalida"; exit 1
        ;;
    esac
  fi
fi

echo "=== 4/4 subindo o servidor ==="
cat > start.sh << EOF
#!/usr/bin/env bash
# Sobe o servidor (gRPC + painel). Reinicie com: ./start.sh
set -u
HERE="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "\$HERE"
pkill -f 'node src/index.js' 2>/dev/null
sleep 1
export DT_SERVER_DIR="\$HERE/keys"
export DT_DATA_DIR="\$HERE/data"
export GRPC_PORT=${GRPC_PORT}
export DT_PANEL_PORT=${PANEL_PORT}
export DT_PANEL_PASSWORD=${PANEL_PASS}
export DT_LOG_FILE=/tmp/dtunnel-server.log
: > "\$DT_LOG_FILE"

# porta privilegiada sem root: usa authbind se existir
LAUNCH=(node src/index.js)
if [[ "\${GRPC_PORT}" -lt 1024 ]] && [[ "\$(id -u)" != "0" ]] && command -v authbind >/dev/null 2>&1; then
  LAUNCH=(authbind node src/index.js)
  echo "[*] usando authbind para a porta \${GRPC_PORT}"
fi

setsid nohup "\${LAUNCH[@]}" >> "\$DT_LOG_FILE" 2>&1 < /dev/null &
disown
sleep 4
if ! grep -q "gRPC TLS server listening" "\$DT_LOG_FILE" 2>/dev/null; then
  echo "[ERRO] o servidor nao subiu:"
  tail -15 "\$DT_LOG_FILE"
  exit 1
fi
ss -tlnp | grep -E ':(\${GRPC_PORT}|\${PANEL_PORT})'
head -6 "\$DT_LOG_FILE"
EOF
chmod +x start.sh
./start.sh

echo ""
echo "=============================================="
echo " Servidor pronto!"
echo "   gRPC  : ${HOST}:${GRPC_PORT}"
echo "   Painel: http://${HOST}:${PANEL_PORT}  (panel / ${PANEL_PASS})"
echo "   Logs  : /tmp/dtunnel-server.log"
echo "=============================================="
