# DTunnel — Servidor Node.js + Painel Web

Reimplementação em **Node.js** do backend gRPC do DTunnel, com **painel web** para editar
as configurações servidas ao app.

> O backend em **Python** continua em `/home/wellington/work/server/` como backup.
> Ambos leem/escrevem **os mesmos arquivos de dados** (`server/exemplos/`), então
> trocar de um para o outro não perde nada.

---

## O que o servidor faz

- Sobe um servidor **gRPC sobre TLS** na porta 443 com os 4 serviços do app:
  `ConfigService`, `AppConfigService`, `TextService`, `DeviceService`
- **Assina cada reply** com ECDSA P-256 (`SHA256withECDSA`), campo trailer
  `x-dtunnel-signature-bin`. Sem isso o app descarta a resposta e a lista de
  conexões fica vazia.
- Serve o **painel web** para editar os JSONs de dados em tempo real.

---

## Arquivos de dados (editáveis pelo painel)

Todos em `/home/wellington/work/server/exemplos/`:

| Arquivo | Serviço gRPC | Conteúdo |
|---|---|---|
| `configs.json` | `ConfigService/GetConfig` | lista de conexões do app |
| `categories.json` | `ConfigService/getCategories` | abas de categoria |
| `cdns.json` | `ConfigService/getEndpoints` | endpoints CDN |
| `app_configs.json` | `AppConfigService/GetAppConfig` | flags/aparência da UI |
| `texts.json` | `TextService/getTexts` | textos da interface |

`configs.json` é convertido automaticamente para o **schema nativo do app**
(campos `mode`, `dt_protocol`, `proxy_host`, `dns1`, `limit_*`…) pelo
`server/gen_native.py`. Pode-se editar no formato cru.

---

## Porta 443 (privilegiada)

Portas abaixo de 1024 exigem privilégio. O `setup.sh` detecta isso e oferece
as opções:

| Opção | Comando | Observação |
|---|---|---|
| (a) rodar com sudo | `sudo ./setup.sh HOST 443 4000 senha` | mais simples |
| (b) authbind | `sudo apt-get install -y authbind` | o binário do node não é alterado |
| (c) capability | `sudo setcap 'cap_net_bind_service=+ep' $(which node)` | vale uma vez só |
| (d) porta alta | `./setup.sh HOST 38443 4000 senha` | sem privilégio nenhum |

Na opção (d) o APK precisa ser refeito com a porta nova:

```bash
./make_mod.sh HOST 38443
```

O `start.sh` gerado detecta o `authbind` e o usa automaticamente.

## Rodando em outro servidor

Veja **[DEPLOY.md](DEPLOY.md)** — tem os dois caminhos (copiar e rodar o
`setup.sh` lá, ou o `deploy_node_server.sh` que faz tudo por scp).

## Rodando localmente

```bash
# 1. instalar dependencias
cd /home/wellington/work/server-node && npm install

# 2. subir gRPC (18443) + painel (8090)
bash /home/wellington/work/patch/start_node_server.sh 18443 8090
```

Acesso: <http://localhost:8090> — usuário `panel`, senha `dtunnel`
(ou defina `DT_PANEL_PASSWORD`).

Variáveis de ambiente:

| Var | Padrão | Descrição |
|---|---|---|
| `GRPC_PORT` | `443` | porta do gRPC |
| `DT_PANEL_PORT` | `4000` | porta do painel web |
| `DT_PANEL_PASSWORD` | `dtunnel` | senha do painel |
| `DT_SERVER_DIR` | `/home/wellington/work/server` | onde ficam `server.pem`/`server.key`/`server_reply.key` |
| `DT_DATA_DIR` | `/home/wellington/work/server/exemplos` | pasta dos JSONs editáveis |
| `DT_LOG_FILE` | `/tmp/srv_remote.log` | log lido pela aba "Logs" |
| `DATA_MODE` | `array` | formato do `GetConfig`: `array` \| `object` \| `b64` |

---

## Deploy no servidor remoto

```bash
bash /home/wellington/work/patch/deploy_node_server.sh SEU_IP 443 4000
```

Envia o código, instala as dependências e reinicia. O script remoto fica em
`/root/start_node.sh`.

O servidor remoto precisa de:
- `server.key` / `server.pem` (cert TLS do host)
- `server_reply.key` (chave privada de assinatura dos replies)
- `ca.pem` (CA correspondente ao `dtca.pem` embutido no APK)

---

## Painel web

- **Aba Conexões** — lista de conexões (`configs.json`)
- **Aba Categorias** — `categories.json`
- **Aba Endpoints** — `cdns.json`
- **Aba App Config** — `app_configs.json`
- **Aba Textos** — `texts.json`
- **Aba Logs** — log do servidor gRPC

Recursos: busca em tempo real, edição inline, botão *Novo*, *Excluir*,
*Salvar* (com backup `.bak` automático) e *Restaurar backup*.

No editor de conexão é possível:

- selecionar os **endpoints/CDNs** cadastrados na aba Endpoints (campo
  `udp_servers`; a porta 443 é adicionada quando o endpoint não tem porta);
- editar **usuário e senha** da conexão (bloco `auth`);
- definir categoria, payload, SNI, TLS, proxy, DNS, portas UDP etc.

A senha do painel pode ser trocada pelo botão **Alterar senha** (lateral).
A nova senha fica gravada com scrypt em `data/panel_auth.json`; apague esse
arquivo para voltar à senha de `DT_PANEL_PASSWORD`.

API REST (Basic auth `panel:SENHA`):

```
GET  /api/health
GET  /api/status
GET  /api/files
GET  /api/auth/state
POST /api/auth/change       { current, newPassword }
GET  /api/:key              -> configs|categories|cdns|app_configs|texts
PUT  /api/:key              { data: [...] }   (recusa array vazio sem force:true)
POST /api/:key/restore      restaura o .bak
POST /api/:key/search       { q: "termo" }
GET  /api/logs?n=300
```

---

## Detalhes do protocolo (reply assinado)

O app valida a assinatura de cada resposta com a chave pública EC guardada em
`wz.h` (base64 do X509/SPKI DER). Buffer assinado:

```
"dtunnel-rpc-v1\0"
| int32(len(method)) | method
| nonce (32 bytes)
| int64(issued) | int64(expires)
| int64(len(pub))  | pub (SPKI DER)
```

Assinado com SHA256withECDSA (DER). Trailers enviados:

`x-dtunnel-signature-bin`, `x-dtunnel-issued`, `x-dtunnel-expires`,
`x-dtunnel-key-id`, `x-dtunnel-nonce-bin`.

O `nonce` e o `key-id` vêm do request; o `issued`/`expires` são gerados pelo
servidor (TTL 5 min).

> **Atenção:** a chave privada de assinatura (`server_reply.key`) e a pública
> embutida no APK (`wz.h`) precisam ser o mesmo par. Ao refazer o APK com
> `patch/set_update_server.py`, a chave pública em `wz.h` **não** muda — então
> basta manter o mesmo `server_reply.key` nos dois lados.
