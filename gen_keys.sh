#!/usr/bin/env bash
# Gera a CA + certificado TLS do servidor, e a chave de assinatura dos replies.
#
#   ./gen_keys.sh <host> [porta]
#
# Gera:
#   ca.key / ca.pem              -> CA (instalada como res/raw/dtca.pem no APK)
#   server.key / server.pem      -> certificado TLS do servidor
#   server_reply.key             -> chave privada de assinatura dos replies (ECDSA P-256)
#   server_reply_key.json        -> chave publica (base64 SPKI DER) p/ o wz.h do APK
set -euo pipefail

HOST="${1:?uso: gen_keys.sh <host> [porta]}"
PORT="${2:-443}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${KEYS_DIR:-$HERE/keys}"
mkdir -p "$OUT"

if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$HOST" == *:* ]]; then
  SAN="IP:${HOST}"
else
  SAN="DNS:${HOST}"
fi
echo "[*] host=${HOST} porta=${PORT} SAN=${SAN}"

# ---------------- CA ----------------
# Em modo plaintext (DT_TLS=0) o servidor nao usa TLS: nao ha CA nem
# certificado. A chave de assinatura dos replies (abaixo) continua
# sendo obrigatoria - ela nao e TLS, e a assinatura das respostas gRPC.
if [[ "${DT_TLS:-1}" == "0" ]]; then
  echo "[*] DT_TLS=0: pulando CA e certificado TLS (o servidor fala h2c)"
else
if [[ ! -f "$OUT/ca.pem" || ! -f "$OUT/ca.key" ]]; then
  # Config proprio: o openssl.cnf do sistema ja adiciona basicConstraints/
  # keyUsage no [v3_ca]; com -addext as extensoes ficam DUPLICADAS e a
  # cadeia deixa de validar ("unable to get local issuer certificate").
  CA_CNF="$OUT/ca.cnf"
  cat > "$CA_CNF" << EOF
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
CN = DTunnel Local CA

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$OUT/ca.key" -out "$OUT/ca.pem" \
    -config "$CA_CNF" || { echo "[ERRO] falha ao criar a CA"; exit 1; }
  rm -f "$CA_CNF"
  chmod 600 "$OUT/ca.key"
  echo "[+] CA criada"
else
  echo "[*] CA ja existe, reaproveitando"
fi

# ---------------- certificado do servidor ----------------
SERVER_CNF="$OUT/server.cnf"
cat > "$SERVER_CNF" << EOF
[req]
distinguished_name = dn
prompt = no

[dn]
CN = ${HOST}

[v3_srv]
subjectAltName = ${SAN}
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
EOF
openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$OUT/server.key" -out "$OUT/server.csr" \
  -config "$SERVER_CNF" -subj "/CN=${HOST}" 2>/dev/null
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca.key" \
  -CAcreateserial -days 3650 -sha256 \
  -extfile "$SERVER_CNF" -extensions v3_srv \
  -out "$OUT/server.pem" || { echo "[ERRO] falha ao assinar o certificado do servidor"; exit 1; }
chmod 600 "$OUT/server.key"
rm -f "$OUT/server.csr" "$SERVER_CNF"
echo "[+] certificado TLS gerado (${SAN})"

# confere a cadeia: se nao validar, o APK vai abortar o update em silencio
if openssl verify -CAfile "$OUT/ca.pem" "$OUT/server.pem" >/dev/null 2>&1; then
  echo "[+] cadeia validada (CA -> server.pem)"
else
  echo "[ERRO] a cadeia CA -> server.pem nao valida. O app vai recusar o TLS."
  openssl verify -CAfile "$OUT/ca.pem" "$OUT/server.pem" || true
  exit 1
fi
fi

# ---------------- chave de assinatura dos replies ----------------
python3 - "$OUT" << 'PYEOF'
import base64, json, os, sys
out = sys.argv[1]
try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("[!] 'cryptography' nao instalado - pulei a chave de assinatura dos replies")
    print("    (pip install cryptography  ou  apt-get install python3-cryptography)")
    sys.exit(0)

# O default_backend() foi REMOVIDO no 'cryptography' >= 42. Nas versoes
# antigas (<3.1) ele e' obrigatorio; nas novas (>=3.1) nao existe.
try:
    from cryptography.hazmat.backends import default_backend
    BACKEND = default_backend()
except Exception:
    BACKEND = None

kp = os.path.join(out, "server_reply.key")
if not os.path.exists(kp):
    if BACKEND is not None:
        priv = ec.generate_private_key(ec.SECP256R1(), BACKEND)
    else:
        priv = ec.generate_private_key(ec.SECP256R1())
    open(kp, "wb").write(priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()))
    os.chmod(kp, 0o600)
    print("[+] chave de assinatura dos replies criada")
else:
    print("[*] chave de assinatura dos replies ja existe, reaproveitando")

try:
    priv = serialization.load_pem_private_key(
        open(kp, "rb").read(), password=None,
        **({"backend": BACKEND} if BACKEND is not None else {}))
except TypeError:
    priv = serialization.load_pem_private_key(open(kp, "rb").read(), password=None)

pub_der = priv.public_key().public_bytes(
    encoding=serialization.Encoding.DER,
    format=serialization.PublicFormat.SubjectPublicKeyInfo)
json.dump({"pub_b64": base64.b64encode(pub_der).decode()},
          open(os.path.join(out, "server_reply_key.json"), "w"), indent=1)
print("[+] chave publica (wz.h) exportada em server_reply_key.json")
PYEOF

echo "[+] arquivos em $OUT"
ls -la "$OUT"
