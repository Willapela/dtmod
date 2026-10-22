#!/usr/bin/env bash
# ============================================================
# DTunnel - reinicia o servidor (roda DENTRO do servidor)
# ============================================================
#  Reinicia o backend gRPC + painel web:
#     - para o processo/servico atual
#     - sobe de novo (systemd, PM2 ou start.sh)
#     - mostra o log do boot e confere se as portas subiram
#
#  Uso:
#     ./restart.sh              # reinicia e mostra o log
#     ./restart.sh --quiet      # so reinicia, sem log
#     ./restart.sh --status     # apenas mostra o estado atual
#
#  As portas e a senha sao lidas do servico systemd (se existir) ou
#  do start.sh; se nao achar, usa os defaults (8443 / 4000).
# ============================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUIET=0
STATUS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    -q|--quiet)  QUIET=1 ;;
    --status)    STATUS_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "[ERRO] argumento desconhecido: $arg"
      echo "       use: ./restart.sh [--quiet] [--status]"
      exit 1 ;;
  esac
done

say() { [ "$QUIET" = "1" ] || echo "$*"; }

# ── descobrir as configuracoes ──────────────────────────────
GRPC_PORT=8443
PANEL_PORT=4000
PANEL_PASS="dtunnel"
DT_TLS="auto"
LOG_FILE="/tmp/dtunnel-server.log"

for f in /etc/systemd/system/dtunnel.service "$HERE/dtunnel.service"; do
  [ -f "$f" ] || continue
  p=$(grep -oE 'GRPC_PORT=[0-9]+' "$f" | head -1 | cut -d= -f2)
  q=$(grep -oE 'DT_PANEL_PORT=[0-9]+' "$f" | head -1 | cut -d= -f2)
  s=$(grep -oE 'DT_PANEL_PASSWORD=[^ ]+' "$f" | head -1 | cut -d= -f2 | tr -d "'")
  t=$(grep -oE 'DT_TLS=[^ ]+' "$f" | head -1 | cut -d= -f2)
  l=$(grep -oE 'DT_LOG_FILE=[^ ]+' "$f" | head -1 | cut -d= -f2 | tr -d "'")
  [ -n "$p" ] && GRPC_PORT="$p"
  [ -n "$q" ] && PANEL_PORT="$q"
  [ -n "$s" ] && PANEL_PASS="$s"
  [ -n "$t" ] && DT_TLS="$t"
  [ -n "$l" ] && LOG_FILE="$l"
  break
done

# ── funcoes ────────────────────────────────────────────────
procura_processo() {
  pgrep -f 'dtunnel-server/src/index.js' >/dev/null 2>&1 && return 0
  pgrep -f 'node src/index.js' >/dev/null 2>&1 && return 0
  return 1
}

porta_ouvindo() {
  ss -tln 2>/dev/null | grep -q ":$1 "
}

mostrar_status() {
  echo "=== estado atual ==="
  if procura_processo; then
    echo "  processo : rodando (PID $(pgrep -f 'dtunnel-server/src/index.js' | head -1))"
  else
    echo "  processo : parado"
  fi
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "dtunnel.service"; then
    if systemctl is-active --quiet dtunnel 2>/dev/null; then
      echo "  systemd  : ativo"
    else
      echo "  systemd  : inativo"
    fi
  fi
  echo "  porta gRPC ($GRPC_PORT)  : $(porta_ouvindo "$GRPC_PORT" && echo 'ouvindo' || echo 'fechada')"
  echo "  porta painel ($PANEL_PORT): $(porta_ouvindo "$PANEL_PORT" && echo 'ouvindo' || echo 'fechada')"
  echo "  log: $LOG_FILE"
}

if [ "$STATUS_ONLY" = "1" ]; then
  mostrar_status
  exit 0
fi

# ── 1. parar ───────────────────────────────────────────────
say "=== 1/3 parando o servidor ==="
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "dtunnel.service"; then
  systemctl stop dtunnel 2>/dev/null && say "  [+] dtunnel.service parado"
  systemctl reset-failed dtunnel 2>/dev/null || true
fi

# o systemd tem Restart=always, entao mata o processo DEPOIS de parar
for sig in "" "-9"; do
  pkill $sig -f 'dtunnel-server/src/index.js' 2>/dev/null
  pkill $sig -f 'node src/index.js' 2>/dev/null
  sleep 1
done
procura_processo && say "  [!] ainda ha processo rodando" || say "  [+] processo encerrado"

# ── 2. subir ───────────────────────────────────────────────
say ""
say "=== 2/3 subindo o servidor ==="
subiu=0

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "dtunnel.service"; then
  systemctl start dtunnel 2>/dev/null
  sleep 3
  if systemctl is-active --quiet dtunnel 2>/dev/null; then
    say "  [+] dtunnel.service ativo"
    subiu=1
  else
    say "  [!] o systemd nao subiu o servico"
  fi
fi

if [ "$subiu" != "1" ] && command -v pm2 >/dev/null 2>&1; then
  # 'pm2 restart' REUSA o env antigo do processo (que pode apontar para
  # caminhos de outra maquina -> o server nem sobe). Por isso o processo e
  # RECRIADO, com o env e o cwd corretos.
  pm2 delete dtunnel >/dev/null 2>&1 || true
  pm2 delete all >/dev/null 2>&1 || true
  if DT_SERVER_DIR="$HERE/keys" \
     DT_DATA_DIR="$HERE/data" \
     GRPC_PORT="$GRPC_PORT" \
     DT_PANEL_PORT="$PANEL_PORT" \
     DT_PANEL_PASSWORD="$PANEL_PASS" \
     DT_TLS="$DT_TLS" \
     DT_LOG_FILE="$LOG_FILE" \
     pm2 start "$HERE/src/index.js" --name dtunnel --cwd "$HERE" \
        --update-env >/dev/null 2>&1; then
    say "  [+] iniciado via PM2 (env e cwd corrigidos)"
    subiu=1
  else
    say "  [!] o PM2 nao conseguiu iniciar o processo"
  fi
fi

if [ "$subiu" != "1" ] && [ -f "$HERE/start.sh" ]; then
  GRPC_PORT="$GRPC_PORT" DT_PANEL_PORT="$PANEL_PORT" \
  DT_PANEL_PASSWORD="$PANEL_PASS" DT_TLS="$DT_TLS" \
  DT_LOG_FILE="$LOG_FILE" bash "$HERE/start.sh" >/dev/null 2>&1 && subiu=1
  [ "$subiu" = "1" ] && say "  [+] iniciado via start.sh"
fi

if [ "$subiu" != "1" ]; then
  say "  [!] nao consegui subir o servidor. Tente manualmente:"
  say "      cd $HERE && GRPC_PORT=$GRPC_PORT DT_PANEL_PORT=$PANEL_PORT \\"
  say "        DT_PANEL_PASSWORD='$PANEL_PASS' DT_TLS=$DT_TLS ./start.sh"
  exit 1
fi

# ── 3. conferir ────────────────────────────────────────────
say ""
say "=== 3/3 conferindo ==="
sleep 2
mostrar_status

if [ "$QUIET" != "1" ]; then
  say ""
  say "--- ultimas linhas do log ---"
  [ -f "$LOG_FILE" ] && tail -12 "$LOG_FILE" || echo "  (sem log em $LOG_FILE)"
fi
