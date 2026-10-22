'use strict';
/**
 * Conversao entre o formato da API oficial do DTunnel (aninhado) e o
 * formato que o app consome (plano/"flat", em configs.json).
 *
 * A API oficial (https://api.dtunnel.com.br/docs#/Config/encodeConfig):
 *   { category_id, name, description, mode, status, sorter, icon,
 *     url_check_user, tls_version, dt_protocol, dt_port,
 *     server: {host, port}, proxy: {host, port},
 *     auth: {username, password, v2ray_uuid},
 *     config_payload: {payload, sni}, config_v2ray,
 *     dns_server: {dns1, dns2}, udp_ports,
 *     dnstt_server, dnstt_name_server, dnstt_key,
 *     hy_port, hy_obfs, hy_up_mbps, hy_down_mbps, hy_insecure, hy_version }
 *
 * O app (configs.json) usa chaves planas:
 *   servers/host/port, proxy[], dns[], username/password, payload/sni, ...
 */

const MODES = [
  'DTUNNEL', 'SSH_DIRECT', 'SSH_PROXY', 'SSH_DNSTT',
  'SSL_DIRECT', 'SSL_PROXY', 'V2RAY', 'HYSTERIA',
];

const STATUS = ['ACTIVE', 'INACTIVE', 'DELETED'];
const PROTOCOLS = ['TCP', 'UDP', 'QUIC'];
const TLS_VERSIONS = ['TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

// campos flat -> nome no formato da API
const FLAT_TO_API = {
  servers: 'server.host',
  host: 'server.host',
  port: 'server.port',
  proxy_host: 'proxy.host',
  proxy_port: 'proxy.port',
  username: 'auth.username',
  password: 'auth.password',
  v2ray_uuid: 'auth.v2ray_uuid',
  payload: 'config_payload.payload',
  sni: 'config_payload.sni',
  dns1: 'dns_server.dns1',
  dns2: 'dns_server.dns2',
  order: 'sorter',
  category: 'category.name',
  category_id: 'category_id',
  mode: 'mode',
  type: 'mode',
  status: 'status',
  icon: 'icon',
  url_check_user: 'url_check_user',
  bot_url: 'url_check_user',
  description: 'description',
  tls_version: 'tls_version',
  dt_protocol: 'dt_protocol',
  dt_port: 'dt_port',
  udp_ports: 'udp_ports',
  dnstt_server: 'dnstt_server',
  dnstt_name_server: 'dnstt_name_server',
  dnstt_key: 'dnstt_key',
  hy_port: 'hy_port',
  hy_obfs: 'hy_obfs',
  hy_up_mbps: 'hy_up_mbps',
  hy_down_mbps: 'hy_down_mbps',
  hy_insecure: 'hy_insecure',
  hy_version: 'hy_version',
  config_v2ray: 'config_v2ray',
  config_payload: 'config_payload',
};

const API_TO_FLAT = {
  'server.host': 'servers',
  'server.port': 'port',
  'proxy.host': 'proxy_host',
  'proxy.port': 'proxy_port',
  'auth.username': 'username',
  'auth.password': 'password',
  'auth.v2ray_uuid': 'v2ray_uuid',
  'config_payload.payload': 'payload',
  'config_payload.sni': 'sni',
  'dns_server.dns1': 'dns1',
  'dns_server.dns2': 'dns2',
  sorter: 'order',
  config_v2ray: 'config_v2ray',
};

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// campos BHTTP achatados -> dentro de bhttp_config
const BHTTP_FLAT = {
  bhttp_mode: 'mode',
  bhttp_capability_probe: 'capability_probe',
  bhttp_probe_ms: 'timeouts.probe_ms',
  bhttp_dns_ms: 'timeouts.dns_ms',
  bhttp_connect_ms: 'timeouts.connect_ms',
  bhttp_read_ms: 'timeouts.read_ms',
  bhttp_shutdown_ms: 'timeouts.shutdown_ms',
};

/** Aplica os campos BHTTP achatados dentro de bhttp_config. */
function applyBhttp(c, raw) {
  const bh = (raw && raw.bhttp_config && typeof raw.bhttp_config === 'object')
    ? clone(raw.bhttp_config) : {};
  if (!bh.timeouts || typeof bh.timeouts !== 'object') bh.timeouts = {};
  let tocou = false;
  for (const [flat, path] of Object.entries(BHTTP_FLAT)) {
    if (c[flat] !== undefined && c[flat] !== '') {
      setDeep(bh, path, c[flat]);
      tocou = true;
    }
  }
  if (tocou || (raw && raw.bhttp_config)) {
    if (bh.schema_version === undefined) bh.schema_version = 1;
    c.bhttp_config = bh;
  }
  return c;
}

/** Extrai de bhttp_config os campos BHTTP achatados. */
function extractBhttp(c, flat) {
  const bh = flat.bhttp_config;
  if (!bh) return;
  const obj = typeof bh === 'string' ? safeParse(bh) : bh;
  if (!obj || typeof obj !== 'object') return;
  for (const [flatKey, path] of Object.entries(BHTTP_FLAT)) {
    const v = getDeep(obj, path);
    if (v !== undefined) flat[flatKey] = v;
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }
function getDeep(o, path) {
  const p = path.split('.');
  let cur = o;
  for (const k of p) { if (cur === null || cur === undefined) return undefined; cur = cur[k]; }
  return cur;
}
function setDeep(o, path, v) {
  const p = path.split('.');
  let cur = o;
  for (let i = 0; i < p.length - 1; i++) {
    if (!cur[p[i]] || typeof cur[p[i]] !== 'object') cur[p[i]] = {};
    cur = cur[p[i]];
  }
  cur[p[p.length - 1]] = v;
}

/** Config plana (do app) -> objeto no formato da API. */
function toApi(c) {
  const out = {
    category_id: Number(c.category_id) || 0,
    name: c.name || '',
    description: c.description || '',
    mode: c.mode || c.type || 'SSH_PROXY',
    status: c.status || 'ACTIVE',
    sorter: Number(c.order ?? c.sorter ?? 1) || 1,
    icon: c.icon || null,
    url_check_user: c.url_check_user || c.bot_url || null,
    server: { host: c.servers || c.hosts || c.host || '', port: Number(c.port) || 0 },
    proxy: { host: c.proxy_host || '', port: Number(c.proxy_port) || 0 },
    auth: { username: c.username || '', password: c.password || '', v2ray_uuid: c.v2ray_uuid || '' },
    config_payload: { payload: c.payload || '', sni: c.sni || '' },
    config_v2ray: c.config_v2ray || null,
    dns_server: { dns1: c.dns1 || (c.dns || [])[0] || '', dns2: c.dns2 || (c.dns || [])[1] || '' },
    udp_ports: Array.isArray(c.udp_ports) ? c.udp_ports.map(Number) : [],
    dt_protocol: c.dt_protocol || c.proto || 'TCP',
    dt_port: String(c.dt_port ?? c.port_alt ?? c.port ?? '8000'),
    tls_version: c.tls_version || c.tls || 'TLSv1.2',
  };
  // BHTTP: os campos achatados vao para dentro de bhttp_config
  applyBhttp(c, c);
  if (c.dnstt_server) out.dnstt_server = c.dnstt_server;
  if (c.dnstt_name_server) out.dnstt_name_server = c.dnstt_name_server;
  if (c.dnstt_key) out.dnstt_key = c.dnstt_key;
  if (c.hy_port !== undefined && c.hy_port !== '') out.hy_port = String(c.hy_port);
  if (c.hy_obfs) out.hy_obfs = c.hy_obfs;
  if (c.hy_up_mbps !== undefined) out.hy_up_mbps = Number(c.hy_up_mbps) || 0;
  if (c.hy_down_mbps !== undefined) out.hy_down_mbps = Number(c.hy_down_mbps) || 0;
  if (c.hy_insecure !== undefined) out.hy_insecure = !!c.hy_insecure;
  if (c.hy_version !== undefined) out.hy_version = Number(c.hy_version) || 0;
  // extras que o app entende mas a API nao lista
  for (const k of ['flag', 'limit_connections', 'limit_days', 'limit_c', 'limit_d',
                   'category', 'proto', 'port_alt', 'hosts', 'bhttp_config',
                   'requiresUsername', 'requiresPassword', 'requiresUuid',
                   'schema_version', 'selected', 'vpn', 'max_attempts', 'chunk_size',
                   'connect_ms', 'read_ms', 'shutdown_ms', 'dns_ms', 'probe_ms',
                   'requests_per_connection', 'responses_per_request', 'retry_backoff_ms',
                   'coalesce_ms', 'udp_servers', 'batch_mode', 'batch_size',
                   'capability_probe', 'sorter', 'timeouts', 'label', 'text',
                   'config_payload']) {
    if (c[k] !== undefined && out[k] === undefined) out[k] = clone(c[k]);
  }
  return out;
}

/** Objeto no formato da API -> config plana (do app). */
function fromApi(o) {
  const c = {
    id: Number(o.id) || 0,
    category_id: Number(o.category_id) || 0,
    name: o.name || '',
    description: o.description || '',
    icon: o.icon || '',
    mode: o.mode || 'SSH_PROXY',
    type: o.mode || 'SSH_PROXY',
    status: o.status || 'ACTIVE',
    order: Number(o.sorter ?? 1) || 1,
    url_check_user: o.url_check_user || '',
    servers: (o.server && o.server.host) || '',
    port: String((o.server && o.server.port) || 8000),
    proxy_host: (o.proxy && o.proxy.host) || '',
    proxy_port: Number((o.proxy && o.proxy.port) || 0),
    username: (o.auth && o.auth.username) || '',
    password: (o.auth && o.auth.password) || '',
    v2ray_uuid: (o.auth && o.auth.v2ray_uuid) || '',
    payload: (o.config_payload && o.config_payload.payload) || '',
    sni: (o.config_payload && o.config_payload.sni) || '',
    config_v2ray: o.config_v2ray || '',
    dns1: (o.dns_server && o.dns_server.dns1) || '',
    dns2: (o.dns_server && o.dns_server.dns2) || '',
    dns: [
      (o.dns_server && o.dns_server.dns1) || '',
      (o.dns_server && o.dns_server.dns2) || '',
    ].filter(Boolean),
    udp_ports: Array.isArray(o.udp_ports) ? o.udp_ports : [],
    dt_protocol: o.dt_protocol || 'TCP',
    proto: o.dt_protocol || 'TCP',
    dt_port: String(o.dt_port || 8000),
    port_alt: Number(o.dt_port) || 8000,
    tls_version: o.tls_version || 'TLSv1.2',
    tls: o.tls_version || 'TLSv1.2',
  };
  // proxy: a API tem host/port, o app usa a lista "host:porta"
  if (c.proxy_host) {
    c.proxy = [`${c.proxy_host}:${c.proxy_port || 0}`];
  } else if (Array.isArray(o.proxy)) {
    c.proxy = o.proxy.slice();
  }
  // BHTTP: o app recebe o config como string JSON
  if (o.bhttp_config && typeof o.bhttp_config === 'object') {
    c.bhttp_config = JSON.stringify(o.bhttp_config);
    extractBhttp(c, c);
  }
  for (const k of ['dnstt_server', 'dnstt_name_server', 'dnstt_key', 'hy_port', 'hy_obfs',
                   'hy_up_mbps', 'hy_down_mbps', 'hy_insecure', 'hy_version', 'flag',
                   'limit_connections', 'limit_days', 'limit_c', 'limit_d', 'category',
                   'requiresUsername', 'requiresPassword', 'requiresUuid',
                   'schema_version', 'selected', 'vpn', 'udp_servers', 'batch_mode',
                   'batch_size', 'capability_probe', 'timeouts', 'label', 'text']) {
    if (o[k] !== undefined) c[k] = clone(o[k]);
  }
  return c;
}

/** Converte uma lista (API -> app). Itens que ja estao no formato
 *  plano sao mantidos como estao (o fromApi so serve pro aninhado). */
function listFromApi(l) {
  return (l || []).map((c) => (isNested(c) ? fromApi(c) : c));
}

/**
 * Normaliza um item para o formato aninhado da API oficial, sem chaves
 * "planas" sobrando (evita dois valores divergentes para o mesmo campo).
 */
// campos que a API oficial nao tem, mas o app entende (preservados)
const EXTRAS = [
  'id', 'category', 'color', 'flag',
  'limit_connections', 'limit_days', 'limit_c', 'limit_d',
  'requiresUsername', 'requiresPassword', 'requiresUuid',
  'schema_version', 'selected', 'vpn',
  'max_attempts', 'chunk_size', 'connect_ms', 'read_ms', 'shutdown_ms',
  'dns_ms', 'probe_ms', 'requests_per_connection', 'responses_per_request',
  'retry_backoff_ms', 'coalesce_ms',
  'udp_servers', 'batch_mode', 'batch_size', 'capability_probe',
  'timeouts', 'label', 'text',
];

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const flat = isNested(raw) ? fromApi(raw) : raw;
  const out = toApi(flat);
  // guarda so o que a API nao conhece (nao as chaves planas do schema)
  for (const k of EXTRAS) {
    if (flat[k] !== undefined) out[k] = clone(flat[k]);
  }
  if (raw.id !== undefined) out.id = raw.id;
  if (raw.category_id !== undefined) out.category_id = raw.category_id;
  return out;
}

function isNested(o) {
  return !!(o && typeof o === 'object' &&
    (o.server || o.dns_server || o.config_payload ||
     (o.proxy && typeof o.proxy === 'object' && 'host' in o.proxy)));
}

/**
 * Sincroniza as categorias a partir das conexoes.
 *
 * A conexao aninhada traz a categoria completa (id, name, color, sorter).
 * Se o id nao existir no categories.json, o app agrupa a conexao por ele e
 * ela NAO aparece em lugar nenhum (a lista fica vazia). Por isso criamos/
 * atualizamos a categoria junto com a conexao.
 */
function syncCategories(configs, current) {
  const out = Array.isArray(current) ? clone(current) : [];
  const byId = new Map(out.map((c) => [String(c.id), c]));
  for (const cfg of configs || []) {
    const cat = (cfg && typeof cfg.category === 'object') ? cfg.category : null;
    const rawId = (cat && cat.id) || cfg.category_id;
    if (rawId === undefined || rawId === null || rawId === 0) continue;
    const id = String(rawId);
    const atual = byId.get(id);
    const nome = (cat && cat.name) || (atual && atual.name) ||
      (cfg.category && typeof cfg.category === 'string' ? cfg.category : '') || `Categoria ${id}`;
    const novo = {
      id: Number(rawId),
      name: nome,
      color: (cat && cat.color) || (atual && atual.color) || '#2196F3',
      sorter: Number((cat && cat.sorter) ?? (atual && atual.sorter) ?? 1) || 1,
      status: (cat && cat.status) || (atual && atual.status) || 'ACTIVE',
    };
    if (atual) Object.assign(atual, novo);
    else { out.push(novo); byId.set(id, novo); }
  }
  return out;
}

/** Converte uma lista (app -> API). */
function listToApi(l) {
  return (l || []).map(toApi);
}

module.exports = {
  MODES, STATUS, PROTOCOLS, TLS_VERSIONS,
  toApi, fromApi, listToApi, listFromApi, normalize, isNested, syncCategories,
  FLAT_TO_API, API_TO_FLAT,
};
