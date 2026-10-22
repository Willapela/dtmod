#!/usr/bin/env bash
# ============================================================
# DTunnel - desinstalador (roda DENTRO do servidor)
# ============================================================
#  Remove TUDO que o install.sh/setup.sh criaram:
#     - o processo do servidor (node) e o servico systemd
#     - a entrada no PM2
#     - as regras do ufw (gRPC, painel e as portas internas)
#     - o diretorio de instalacao (com as chaves e os dados)
#     - o log e o dump do PM2
#
#  Uso:
#     ./uninstall.sh                 # pede confirmacao
#     ./uninstall.sh --yes           # nao pergunta
#     ./uninstall.sh --yes --keep-data  # mantem data/ e keys/ (so remove o servico)
#
#  ATENCAO: o Node.js e o npm NAO sao removidos (podem ser usados por
#  outros programas). O firewall (ufw) tambem NAO e desabilitado - apenas
#  as regras deste servidor sao removidas.
# ============================================================
set -uo pipefail

ASSUME_YES=0
KEEP_DATA=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes)     ASSUME_YES=1 ;;
    --keep-data)  KEEP_DATA=1 ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "[ERRO] argumento desconhecido: $arg"
      echo "       use: ./uninstall.sh [--yes] [--keep-data]"
      exit 1 ;;
  esac
done

say()  { echo "$*"; }
step() { echo ""; echo "=== $* ==="; }

# ── 0. confirmacao ──────────────────────────────────────────
if [ "$ASSUME_YES" != "1" ]; then
  echo "=============================================="
  echo "  Isso vai REMOVER o servidor DTunnel deste host:"
  echo "    - processo, servico systemd e entrada do PM2"
  echo "    - regras do ufw do gRPC e do painel"
  echo "    - o diretorio de instalacao (com as chaves e as configs)"
  echo ""
  echo "  O Node.js e o ufw NAO sao desinstalados."
  echo "=============================================="
  printf "  Tem certeza? [s/N] "
  read -r resp
  case "$resp" in
    [sSyY]*) ;;
    *) echo "cancelado."; exit 0 ;;
  esac
fi

# ── 1. descobrir onde esta instalado ───────────────────────
# o diretorio de onde o script esta rodando (pode ser um path livre)
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DIRS=()
for d in "$SELF_DIR" "$HOME/dtunnel-server" /root/dtunnel-server /etc/dtunnel/dtunnel-server \
         /opt/dtunnel-server /usr/local/dtunnel-server /srv/dtunnel-server; do
  [ -d "$d" ] || continue
  # nao apaga "/" nem "/" nem a home
  case "$d" in
    /|/root|/home|"$HOME"|/etc|/usr|/var|/opt|/srv|/tmp) continue ;;
  esac
  DIRS+=("$d")
done
# tira duplicados
UNIQ=()
for d in "${DIRS[@]:-}"; do
  dup=0
  for u in "${UNIQ[@]:-}"; do [ "$d" = "$u" ] && dup=1 && break; done
  [ "$dup" = "0" ] && UNIQ+=("$d")
done
DIRS=("${UNIQ[@]:-}")

GRPC_PORTS=()
PANEL_PORTS=()
for d in "${DIRS[@]:-}"; do
  [ -d "$d" ] || continue
  # le as portas do servico systemd (se existir) para remover as regras certas
  for f in /etc/systemd/system/dtunnel.service "$d"/dtunnel.service; do
    [ -f "$f" ] || continue
    p=$(grep -oE 'GRPC_PORT=[0-9]+' "$f" | head -1 | cut -d= -f2)
    q=$(grep -oE 'DT_PANEL_PORT=[0-9]+' "$f" | head -1 | cut -d= -f2)
    [ -n "$p" ] && GRPC_PORTS+=("$p")
    [ -n "$q" ] && PANEL_PORTS+=("$q")
  done
done
# defaults + as portas internas do modo auto (porta+100, porta+200)
for p in 8443 443; do GRPC_PORTS+=("$p"); done
for p in 8080; do PANEL_PORTS+=("$p"); done

# ── 2. parar o servico ─────────────────────────────────────
step "1/6 parando o servidor"
if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files 2>/dev/null | grep -q "dtunnel.service"; then
    systemctl stop dtunnel 2>/dev/null && say "  [+] dtunnel.service parado"
    systemctl disable dtunnel 2>/dev/null && say "  [+] dtunnel.service desabilitado no boot"
  fi
  # remove o .service (e o symlink em wants/)
  rm -f /etc/systemd/system/dtunnel.service
  rm -f /etc/systemd/system/multi-user.target.wants/dtunnel.service
  systemctl daemon-reload 2>/dev/null && say "  [+] systemd recarregado"
  systemctl reset-failed dtunnel 2>/dev/null || true
fi

# mata o processo (qualquer instancia, com caminho absoluto ou nao).
# o systemd tem Restart=always, entao so mata DEPOIS de parar o servico.
for sig in "" "-9"; do
  pkill $sig -f 'dtunnel-server/src/index.js' 2>/dev/null
  pkill $sig -f 'node src/index.js' 2>/dev/null
  sleep 1
done
pgrep -f 'dtunnel-server/src/index.js' >/dev/null 2>&1 && \
  say "  [!] ainda ha processo do DTunnel" || say "  [+] processo node do DTunnel encerrado"

# ── 3. PM2 ────────────────────────────────────────────────
step "2/6 removendo do PM2"
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete dtunnel 2>/dev/null && say "  [+] app 'dtunnel' removida do PM2"
  pm2 delete all 2>/dev/null || true
  pm2 save 2>/dev/null || true
  say "  [+] dump do PM2 atualizado"
fi
rm -f "$HOME/.pm2/dump.pm2" 2>/dev/null

# ── 4. firewall ───────────────────────────────────────────
step "3/6 removendo as regras do firewall"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  # portas do gRPC, do painel e as internas do modo auto
  # neste host o "ufw delete <porta>/tcp" da "Invalid syntax" - a forma
  # que funciona e' pelo NUMERO da regra ("ufw status numbered"). Como
  # deletar renumera as outras, o indices sao lidos de baixo para cima.
  # (deletar pelo numero tambem remove a regra v6 correspondente)
  ALL_PORTS=()
  for p in "${GRPC_PORTS[@]}" "${PANEL_PORTS[@]}"; do
    [ -n "$p" ] || continue
    ALL_PORTS+=("$p")
  done
  for p in "${GRPC_PORTS[@]}"; do
    [ -n "$p" ] || continue
    ALL_PORTS+=($((p + 100)) $((p + 200)))
  done
  # remove as regras que casam com as portas do DTunnel (v4 e v6)
  while true; do
    num=$(ufw status numbered 2>/dev/null | grep -E "^\[[ 0-9]+\]" | \
          grep -E "($(IFS='|'; echo "${ALL_PORTS[*]}"))/tcp" | \
          tail -1 | grep -oE "^\[[ 0-9]+\]" | tr -d '[] ')
    [ -n "$num" ] || break
    ufw --force delete "$num" >/dev/null 2>&1 || break
  done
  # relatorio do que sobrou
  RESTOU=$(ufw status 2>/dev/null | grep -cE "($(IFS='|'; echo "${ALL_PORTS[*]}"))/tcp")
  if [ "$RESTOU" = "0" ]; then
    say "  [+] ufw: todas as regras do DTunnel removidas"
  else
    say "  [!] sobraram $RESTOU regra(s) do ufw - remova com:"
    say "      ufw status numbered | grep 8443"
    say "      ufw --force delete <numero>"
  fi
else
  say "  [*] ufw inativo - pulei"
fi

# ── 5. arquivos ───────────────────────────────────────────
step "4/6 removendo os arquivos"
if [ "$KEEP_DATA" = "1" ]; then
  say "  [*] --keep-data: mantendo data/ e keys/"
  for d in "${DIRS[@]:-}"; do
    [ -d "$d" ] || continue
    find "$d" -mindepth 1 -maxdepth 1 ! -name data ! -name keys -exec rm -rf {} + 2>/dev/null
    say "  [+] $d limpo (data/ e keys/ mantidos)"
  done
else
  for d in "${DIRS[@]:-}"; do
    [ -d "$d" ] || continue
    rm -rf "$d" && say "  [+] $d removido"
  done
  # diretorio pai, se ficou vazio
  rmdir /etc/dtunnel 2>/dev/null && say "  [+] /etc/dtunnel removido"
fi

rm -f /tmp/dtunnel-server.log && say "  [+] /tmp/dtunnel-server.log removido"

# ── 6. conferencia ─────────────────────────────────────────
step "5/6 conferindo"
sobrou=0
if pgrep -f 'dtunnel-server/src/index.js' >/dev/null 2>&1; then
  say "  [!] ainda ha processo do DTunnel rodando"
  sobrou=1
fi
if systemctl list-unit-files 2>/dev/null | grep -q "dtunnel.service"; then
  say "  [!] ainda existe o dtunnel.service"
  sobrou=1
fi
for d in "${DIRS[@]:-}"; do
  if [ -d "$d" ] && [ "$KEEP_DATA" != "1" ]; then
    say "  [!] ainda existe $d"
    sobrou=1
  fi
done

step "6/6 pronto"
if [ "$sobrou" = "0" ]; then
  say "  DTunnel removido completamente deste servidor."
else
  say "  [!] sobrou alguma coisa (veja acima). Confira manualmente:"
  say "      pgrep -af 'dtunnel-server'"
  say "      systemctl list-unit-files | grep dtunnel"
  say "      ls -d /root/dtunnel-server /etc/dtunnel 2>/dev/null"
fi
say ""
say "  Lembretes:"
say "    - o Node.js e o npm continuam instalados"
say "    - o ufw continua ativo (so as regras deste servidor foram removidas)"
say "    - o app no celular ainda aponta para este servidor: reinstale o"
say "      app apontando para outro host (ou desinstale o app)"
