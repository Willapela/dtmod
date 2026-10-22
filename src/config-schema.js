'use strict';
/**
 * Campos editaveis de cada modo de conexao.
 *
 * A lista segue o formulario do painel oficial do DTunnel. O formato
 * guardado e o da API oficial (aninhado); o app recebe a versao plana
 * (ver config-codec.js / native.js).
 */

// ---------------------------------------------------------------- campos base
const NOME = { k: 'name', t: 'text', l: 'Nome', h: 'Digite um nome descritivo' };
const DESC = { k: 'description', t: 'textarea', l: 'Descrição', h: 'Descreva a finalidade e os detalhes importantes' };
// Categoria: select com as categorias ja criadas (o front carrega do /api/categories)
const CATEGORIA = { k: 'category', t: 'category', l: 'Categoria', h: 'escolha ou crie uma nova' };
const ORDEM = { k: 'sorter', t: 'number', l: 'Ordem', h: 'Exemplo: 1' };
const ICONE = { k: 'icon', t: 'text', l: 'Ícone (URL)', h: 'https://exemplo.com/imagem.png' };
const CHECKUSER = { k: 'url_check_user', t: 'text', l: 'Check user', h: 'URL que valida o usuário' };
const USUARIO = { k: 'username', t: 'text', l: 'Usuário', h: 'usuário da autenticação da conexão' };
const SENHA = { k: 'password', t: 'password', l: 'Senha', h: 'senha da autenticação da conexão' };

const PAYLOAD = { k: 'payload', t: 'textarea', l: 'Payload', h: 'payload enviado na conexão' };
const SNI = { k: 'sni', t: 'text', l: 'SNI', h: 'server name (obrigatorio)' };
const PROTO = { k: 'dt_protocol', t: 'select', l: 'Tipo do protocolo', opts: ['TCP', 'UDP', 'QUIC'] };
const TLS = { k: 'tls_version', t: 'select', l: 'Versão TLS', opts: ['TLSv1.1', 'TLSv1.2', 'TLSv1.3'] };

const SERVIDOR = { k: 'servers', t: 'text', l: 'Servidor', h: 'Ex.: tunnel.example.com' };
const PORTA_SERVIDOR = { k: 'port', t: 'number', l: 'Porta do servidor', h: 'Ex: 80' };
const PROXY = { k: 'proxy_host', t: 'text', l: 'Proxy', h: 'Ex: 127.0.0.1' };
const PORTA_PROXY = { k: 'proxy_port', t: 'number', l: 'Porta do proxy', h: 'Ex: 80' };
const DNS1 = { k: 'dns1', t: 'text', l: 'DNS', h: 'Ex: 8.8.8.8' };
const DNS2 = { k: 'dns2', t: 'text', l: 'DNS 2', h: 'Ex: 8.8.4.4' };
const UDP = { k: 'udp_ports', t: 'dns', l: 'Porta(s) UDP', h: 'Ex: 7300,7301,7302' };
const CDN = { k: 'udp_servers', t: 'cdn', l: 'Endpoints (CDN)', h: 'Selecione os endpoints que o app vai usar' };

const DNSTT_KEY = { k: 'dnstt_key', t: 'text', l: 'Key', h: 'Cole aqui a key do DNSTT' };
const DNSTT_NAMESERVER = { k: 'dnstt_name_server', t: 'text', l: 'Nome do servidor', h: 'Ex: ns.exemplo.com' };
const DNSTT_SERVER = { k: 'dnstt_server', t: 'text', l: 'DNS do servidor', h: 'Ex: 8.8.8.8' };

const V2RAY_JSON = { k: 'config_v2ray', t: 'textarea', l: 'JSON Xray', h: 'config_v2ray em JSON' };

// ------------------------------------------------------------------- BHTTP
const BHTTP_AJUSTE = { k: 'bhttp_mode', t: 'select', l: 'Modo de ajuste', opts: ['auto', 'manual', 'safe'] };
const BHTTP_PROBE = { k: 'bhttp_capability_probe', t: 'bool', l: 'Teste de capacidade', h: 'Sim / Não' };
const BHTTP_PROBE_MS = { k: 'bhttp_probe_ms', t: 'number', l: 'Timeout do teste (ms)', h: 'Ex: 2000' };
const BHTTP_DNS_MS = { k: 'bhttp_dns_ms', t: 'number', l: 'Timeout de DNS (ms)', h: 'Ex: 5000' };
const BHTTP_CONNECT_MS = { k: 'bhttp_connect_ms', t: 'number', l: 'Timeout de conexão (ms)', h: 'Ex: 15000' };
const BHTTP_READ_MS = { k: 'bhttp_read_ms', t: 'number', l: 'Timeout de leitura (ms)', h: 'Ex: 30000' };
const BHTTP_SHUTDOWN_MS = { k: 'bhttp_shutdown_ms', t: 'number', l: 'Timeout de encerramento (ms)', h: 'Ex: 5000' };

// ------------------------------------------------------------------ modos
const G = [NOME, DESC, CATEGORIA, ORDEM, ICONE, CHECKUSER];
const AUTH_GROUP = ['Autenticação', [USUARIO, SENHA]];
const ENDPOINTS_GROUP = ['Endpoints', [CDN]];
const MODES = {
  DTUNNEL: {
    label: 'DTunnel',
    hint: 'conexao nativa do app',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [PAYLOAD, PROTO, TLS, SNI]],
      ['Servidor', [SERVIDOR, PORTA_SERVIDOR, PROXY, PORTA_PROXY]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  SSH_DIRECT: {
    label: 'SSH direto',
    hint: 'SSH sem proxy',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [PAYLOAD, SNI]],
      ['Servidor', [SNI, SERVIDOR, PORTA_SERVIDOR]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  SSH_PROXY: {
    label: 'SSH via proxy',
    hint: 'SSH com salto por proxy',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [PAYLOAD, SNI]],
      ['Servidor', [SERVIDOR, PORTA_SERVIDOR, PROXY, PORTA_PROXY]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  SSH_XHTTP: {
    label: 'SSH + XHTTP',
    hint: 'SSH sobre transporte XHTTP',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [SNI, TLS]],
      ['Servidor', [SERVIDOR, PORTA_SERVIDOR, PROXY, PORTA_PROXY]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  SSH_BHTTP: {
    label: 'SSH + BHTTP',
    hint: 'SSH sobre transporte BHTTP (ajuste automatico de rede)',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Servidor', [SNI, SERVIDOR, PORTA_SERVIDOR]],
      ['BHTTP', [BHTTP_AJUSTE, BHTTP_PROBE, BHTTP_PROBE_MS,
                 BHTTP_DNS_MS, BHTTP_CONNECT_MS, BHTTP_READ_MS, BHTTP_SHUTDOWN_MS]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [UDP]],
    ],
  },
  SSH_DNSTT: {
    label: 'SSH + DNSTT',
    hint: 'SSH com resolucao de nome via DNSTT',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['DNSTT', [DNSTT_KEY, DNSTT_NAMESERVER, DNSTT_SERVER]],
      ['Servidor', [SNI, SERVIDOR, PORTA_SERVIDOR]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  SSL_DIRECT: {
    label: 'SSL direto',
    hint: 'TLS direto no servidor',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [SNI, TLS]],
      ['Servidor', [SNI, SERVIDOR, PORTA_SERVIDOR]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  SSL_PROXY: {
    label: 'SSL via proxy',
    hint: 'TLS com salto por proxy',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [PAYLOAD, SNI, TLS]],
      ['Servidor', [SERVIDOR, PORTA_SERVIDOR, PROXY, PORTA_PROXY]],
      ENDPOINTS_GROUP,
      ['DNS / UDP', [DNS1, DNS2, UDP]],
    ],
  },
  V2RAY: {
    label: 'V2Ray',
    hint: 'V2Ray com JSON de configuracao',
    groups: [
      ['Geral', G],
      AUTH_GROUP,
      ['Transporte', [V2RAY_JSON, SNI]],
      ENDPOINTS_GROUP,
      ['DNS', [DNS1, DNS2]],
    ],
  },
};

const DEFAULT_MODE = 'SSH_PROXY';

/** Rotulo automatico para um campo nativo que ainda nao tem rotulo. */
function autoLabel(k) {
  const special = {
    bhttp_mode: 'Modo de ajuste BHTTP',
    bhttp_capability_probe: 'Teste de capacidade',
    bhttp_probe_ms: 'Timeout do teste (ms)',
    bhttp_dns_ms: 'Timeout de DNS (ms)',
    bhttp_connect_ms: 'Timeout de conexão (ms)',
    bhttp_read_ms: 'Timeout de leitura (ms)',
    bhttp_shutdown_ms: 'Timeout de encerramento (ms)',
    udp_servers: 'UDP servers', udp_ports: 'Porta(s) UDP',
    dnstt_server: 'DNS do servidor', dnstt_name_server: 'Nome do servidor',
    dnstt_key: 'Key',
    bhttp_config: 'Configuração BHTTP',
    config_v2ray: 'JSON Xray', config_payload: 'Config payload',
    url_check_user: 'Check user', dt_protocol: 'Tipo do protocolo',
    dt_port: 'Porta alternativa', v2ray_uuid: 'UUID (v2ray)',
    hy_port: 'Porta HY', hy_obfs: 'OBFS HY', hy_up_mbps: 'Banda HY (up)',
    hy_down_mbps: 'Banda HY (down)', hy_insecure: 'HY inseguro', hy_version: 'Versão HY',
    dns1: 'DNS', dns2: 'DNS 2',
    servers: 'Servidor', port: 'Porta do servidor',
    proxy_host: 'Proxy', proxy_port: 'Porta do proxy',
    payload: 'Payload', sni: 'SNI', tls_version: 'Versão TLS',
    order: 'Ordem', sorter: 'Ordem', flag: 'Flag',
    requiresUsername: 'Exige usuário', requiresPassword: 'Exige senha',
    requiresUuid: 'Exige UUID', selected: 'Selecionada', vpn: 'Usa VPN',
    schema_version: 'Versão do schema', limit_c: 'Limite C', limit_d: 'Limite D',
    max_attempts: 'Máx de tentativas', chunk_size: 'Chunk size',
    connect_ms: 'Timeout de conexão (ms)', read_ms: 'Timeout de leitura (ms)',
    shutdown_ms: 'Timeout de encerrar (ms)', dns_ms: 'Timeout de DNS (ms)',
    probe_ms: 'Timeout de probe (ms)', requests_per_connection: 'Req por conexão',
    responses_per_request: 'Resp por req', retry_backoff_ms: 'Backoff (ms)',
    coalesce_ms: 'Coalesce (ms)', label: 'Label', text: 'Texto',
  };
  if (special[k]) return special[k];
  return k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Campos que o app entende e ainda nao aparecem em nenhum grupo. */
function advancedFields(mode) {
  let NATIVE = [];
  try { NATIVE = require('./native').NATIVE_FIELDS || []; } catch (_) {}
  const used = new Set();
  const m = MODES[mode] || MODES[DEFAULT_MODE];
  for (const [, fields] of m.groups) for (const f of fields) for (const k of (f.keys || [f.k])) used.add(k);
  for (const other of Object.values(MODES)) {
    for (const [, fields] of other.groups) for (const f of fields) for (const k of (f.keys || [f.k])) used.add(k);
  }
  const out = [];
  for (const k of NATIVE) {
    if (used.has(k)) continue;
    if (['id', 'category_id', 'mode', 'type'].includes(k)) continue;
    out.push({ k, t: 'auto', l: autoLabel(k), h: 'campo do app' });
  }
  return out;
}

function schema() {
  const codec = require('./config-codec');
  const modes = {};
  for (const [k, m] of Object.entries(MODES)) {
    modes[k] = { label: m.label, hint: m.hint, groups: m.groups };
  }
  // cada campo ganha os caminhos onde ele pode estar:
  //  - no formato aninhado do painel oficial (server.host, dns_server.dns1...)
  //  - no formato plano (servers, dns1...)
  //  - as vezes dentro de outro objeto (category.color)
  const EXTRA_PATHS = {
    dns1: ['dns_server.dns1', 'dns1'],
    dns2: ['dns_server.dns2', 'dns2'],
    color: ['color'],
    category: ['category.name', 'category'],
    proxy_host: ['proxy.host', 'proxy_host'],
    proxy_port: ['proxy.port', 'proxy_port'],
    servers: ['server.host', 'servers', 'hosts'],
    port: ['server.port', 'port'],
    sni: ['config_payload.sni', 'sni'],
    payload: ['config_payload.payload', 'payload'],
    username: ['auth.username', 'username'],
    password: ['auth.password', 'password'],
    uuid: ['auth.v2ray_uuid', 'v2ray_uuid', 'uuid'],
    config_v2ray: ['config_v2ray', 'configV2ray'],
    dt_protocol: ['dt_protocol', 'proto', 'protocol'],
    dt_port: ['dt_port', 'port_alt'],
    bhttp_mode: ['bhttp_config.mode'],
    bhttp_capability_probe: ['bhttp_config.capability_probe'],
    bhttp_probe_ms: ['bhttp_config.timeouts.probe_ms'],
    bhttp_dns_ms: ['bhttp_config.timeouts.dns_ms'],
    bhttp_connect_ms: ['bhttp_config.timeouts.connect_ms'],
    bhttp_read_ms: ['bhttp_config.timeouts.read_ms'],
    bhttp_shutdown_ms: ['bhttp_config.timeouts.shutdown_ms'],
    category_id: ['category_id'],
    order: ['sorter', 'order'],
    status: ['status'],
  };
  for (const m of Object.values(modes)) {
    for (const [, fields] of m.groups) {
      for (const f of fields) {
        const api = codec.FLAT_TO_API[f.k] || f.k;
        const lista = [];
        if (api.includes('.')) lista.push(api);
        for (const p of (EXTRA_PATHS[f.k] || [])) if (!lista.includes(p)) lista.push(p);
        if (!lista.includes(f.k)) lista.push(f.k);
        f.paths = lista;
        f.path = lista[0];
        f.flat = f.k;
      }
    }
  }
  return {
    modes,
    defaultMode: DEFAULT_MODE,
    apiModes: codec.MODES,
    status: codec.STATUS,
    protocols: codec.PROTOCOLS,
    tlsVersions: codec.TLS_VERSIONS,
  };
}

module.exports = { schema, MODES, DEFAULT_MODE, autoLabel };
