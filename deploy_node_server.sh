#!/usr/bin/env bash
# Instala/atualiza o servidor DTunnel em uma maquina remota.
#
#   ./deploy_node_server.sh <host> [grpc_porta=8443] [painel_porta=4000] [senha_painel] [usuario]
#
#   Use 8443 por padrao: o hox.service do mesmo servidor ocupa a porta 443.
#
# Exemplo:
#   ./deploy_node_server.sh 1.2.3.4 8443 4000 minhaSenha root
#   ./deploy_node_server.sh 1.2.3.4 443 4000 minhaSenha admin   # usuario != root
#
# O que faz:
#   1. copia o pacote inteiro (codigo + dados + CHAVES) para o servidor
#   2. roda o setup.sh la (instala deps, gera/usa certs, sobe gRPC + painel)
#
# IMPORTANTE: as chaves de assinatura sao copiadas junto. Assim o APK ja
# instalado continua funcionando. Se quiser chaves novas, apague keys/ no
# servidor antes do deploy e refaca o APK (make_mod.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

HOST="${1:?uso: deploy_node_server.sh <host> [grpc_porta] [painel_porta] [senha_painel] [usuario]}"
GRPC_PORT="${2:-8443}"
PANEL_PORT="${3:-4000}"
PANEL_PASS="${4:-dtunnel}"
USER_NAME="${5:-root}"

# --- autenticacao: senha via SSHPASS, ou chave SSH (sem senha) ---
SSH_OPTS="-o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
if [[ -n "${SSHPASS:-}" ]]; then
  SSH_CMD=(sshpass -p "$SSHPASS" ssh $SSH_OPTS "$USER_NAME@$HOST")
  SCP_CMD=(sshpass -p "$SSHPASS" scp $SSH_OPTS -r)
else
  SSH_CMD=(ssh $SSH_OPTS "$USER_NAME@$HOST")
  SCP_CMD=(scp $SSH_OPTS -r)
fi

# O caminho remoto e SEMPRE $HOME do usuario remoto (o $HOME local seria
# o do PC de onde roda o deploy). O shell remoto expande o $HOME.
REMOTE_DIR='$HOME/dtunnel-server'
REMOTE_HOME="\$HOME"

echo "=== 1/3 enviando o pacote para ${USER_NAME}@${HOST}:\$HOME/dtunnel-server ==="
"${SSH_CMD[@]}" "rm -rf \"${REMOTE_HOME}/dtunnel-server\" && mkdir -p \"${REMOTE_HOME}/dtunnel-server\"" </dev/null
"${SCP_CMD[@]}" "$HERE" "$USER_NAME@$HOST:${REMOTE_HOME}/" </dev/null
# nao leva node_modules (o setup.sh instala as deps)
"${SSH_CMD[@]}" "rm -rf \"${REMOTE_HOME}/dtunnel-server/node_modules\" \"${REMOTE_HOME}/dtunnel-server/start.sh\"" </dev/null
echo "[+] arquivos enviados"

echo "=== 2/3 instalando e subindo no servidor ==="
"${SSH_CMD[@]}" "cd \"${REMOTE_HOME}/dtunnel-server\" && chmod +x ./*.sh && ./setup.sh '${HOST}' ${GRPC_PORT} ${PANEL_PORT} '${PANEL_PASS}'" </dev/null

echo ""
echo "=============================================="
echo " Deploy concluido em ${HOST}"
echo "   gRPC  : ${HOST}:${GRPC_PORT}"
echo "   Painel: http://${HOST}:${PANEL_PORT}  (panel / ${PANEL_PASS})"
echo "   Logs  : /tmp/dtunnel-server.log"
echo "=============================================="
