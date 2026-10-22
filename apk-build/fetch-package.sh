#!/usr/bin/env bash
# Baixa uma revisão fixada do pacote de build do APK para uso local.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/apk-build/.work"
ARCHIVE="$DEST/dtunnel-mod.tar.gz"
COMMIT="a9d17369a95edcb283715fdf8642de3a62ea506b"
SHA256="7e6087527119c27c1e69c5db29d8dd7e66bc01b035bc001490d74be7a02b546c"
URL="https://github.com/internetacessivel-sys/DTUNNEL-MOD/raw/${COMMIT}/dtunnel-mod.tar.gz"

for cmd in curl tar sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "[ERRO] comando necessário ausente: $cmd" >&2; exit 1; }
done
if [[ -e "$DEST/dtunnel-mod" ]]; then
  echo "[ERRO] $DEST/dtunnel-mod já existe. Para refazer o download, remova apenas apk-build/.work/." >&2
  exit 1
fi
mkdir -p "$DEST"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

echo "Baixando pacote fixado em ${COMMIT:0:12}..."
curl --fail --location --silent --show-error "$URL" --output "$tmp"
printf '%s  %s\n' "$SHA256" "$tmp" | sha256sum --check --status || {
  echo "[ERRO] SHA-256 não confere; arquivo não será extraído." >&2
  exit 1
}

# Recusa caminhos absolutos, traversal e conteúdo fora do diretório esperado.
while IFS= read -r member; do
  case "$member" in
    dtunnel-mod/|dtunnel-mod/*) ;;
    *) echo "[ERRO] caminho inesperado no arquivo: $member" >&2; exit 1 ;;
  esac
  case "/$member/" in
    *"/../"*|*"/./"*) echo "[ERRO] caminho inseguro no arquivo: $member" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$tmp")

tar -xzf "$tmp" -C "$DEST" --no-same-owner --no-same-permissions
[[ -f "$DEST/dtunnel-mod/install_deps.sh" && -f "$DEST/dtunnel-mod/make_mod.sh" ]] || {
  echo "[ERRO] pacote sem os scripts esperados; removendo extração." >&2
  rm -rf "$DEST/dtunnel-mod"
  exit 1
}
chmod +x "$DEST/dtunnel-mod/install_deps.sh" "$DEST/dtunnel-mod/sync_keys.sh" "$DEST/dtunnel-mod/make_mod.sh"
echo "Pacote verificado e extraído em: $DEST/dtunnel-mod"
echo "Próximo passo (no seu PC Linux): cd apk-build/.work/dtunnel-mod && ./install_deps.sh"
echo "Não execute o build no servidor público do painel nem publique chaves/APKs."
