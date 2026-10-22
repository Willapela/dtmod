'use strict';
/**
 * Item de configuracao entregue ao app (GetConfig).
 *
 * IMPORTANTE - formato do item:
 * o app oficial (com.dtunnel) deserializa o item do GetConfig no parser
 * NATIVO (liba7c1.so, Lmx;->g(String)). As chaves lidas por esse parser
 * foram extraidas das strings do proprio .so:
 *
 *   mode, type, name, description, icon, id, category_id, order, sorter,
 *   status, url_check_user, flag, connections, selected, schema_version,
 *   username, password, uuid, v2ray_uuid, auth, text, label,
 *   server_host, server_port, host, port, server,
 *   proxy_host, proxy_port, proxy,
 *   dns1, dns2, dns_server, dns_servers,
 *   udp_ports, udp_servers,
 *   tls_version, sni, payload, config_payload, config_v2ray,
 *   dnstt_server, dnstt_name_server, dnstt_key,
 *   bhttp_config, capability_probe, chunk_size, batch_mode, batch_size,
 *   max_attempts, connect_ms, read_ms, shutdown_ms, probe_ms,
 *   requests_per_connection, responses_per_request, retry_backoff_ms,
 *   coalesce_ms, timeouts,
 *   hy_port, hy_obfs, hy_up_mbps, hy_down_mbps, hy_insecure, hy_version,
 *   dt_protocol, dt_port
 *
 * O parser e ESTRITO: campo ausente que ele espera causa erro do tipo
 * "no value <campo>" (toast) e o item e descartado -> a conexao some da
 * lista. Por isso aqui emitimos TODOS os campos do schema, com default.
 *
 * OBS: nao usar nomes em camelCase (ex.: "udpServer"): o parser le
 * "udp_servers" e ignora o resto.
 */

const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return !!v;
};

const str = (v, d = '') => (v === undefined || v === null ? d : String(v));

/** "host:porta" (ou objeto {host,port}) -> {host, port} */
function splitProxy(c) {
  let host = c.proxy_host || '';
  let port = toInt(c.proxy_port, 0);
  if (!host && c.proxy && typeof c.proxy === 'object' && !Array.isArray(c.proxy)) {
    host = c.proxy.host || '';
    port = toInt(c.proxy.port, 0);
  }
  const lista = Array.isArray(c.proxy) ? c.proxy : (typeof c.proxy === 'string' ? [c.proxy] : []);
  if ((!host || !port) && lista.length) {
    const ph = String(lista[0]);
    const i = ph.lastIndexOf(':');
    if (i > 0) {
      if (!host) host = ph.slice(0, i);
      if (!port) port = toInt(ph.slice(i + 1), 0);
    } else if (!host) {
      host = ph;
    }
  }
  return { host, port };
}

function pick(c, ...keys) {
  for (const k of keys) {
    if (c[k] !== undefined && c[k] !== null && c[k] !== '') return c[k];
  }
  return undefined;
}

function obj(v) {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}

function arr(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v];
}

/**
 * Config (formato da API oficial, aninhado OU plano do painel)
 * -> item no schema nativo (snake_case).
 */
function build(c) {
  c = obj(c);
  const srv = obj(c.server);
  const pxyO = (c.proxy && typeof c.proxy === 'object' && !Array.isArray(c.proxy)) ? c.proxy : {};
  const pay = obj(c.config_payload);
  const dnsO = obj(c.dns_server);
  const authO = obj(c.auth);
  const out = {};

  // ---- identidade -------------------------------------------------------
  out.mode = str(pick(c, 'mode', 'type') ?? 'SSH_PROXY');
  out.type = out.mode;
  out.name = str(c.name);
  out.description = str(c.description);
  out.icon = str(c.icon);
  out.id = toInt(c.id, 0);
  out.category_id = toInt(c.category_id, 0);
  out.order = toInt(pick(c, 'order', 'sorter'), 1);
  out.sorter = out.order;
  out.status = str(c.status ?? 'ACTIVE');
  out.url_check_user = str(c.url_check_user);
  out.flag = toInt(c.flag, 0);
  out.connections = toInt(c.connections, 0);
  out.selected = toBool(c.selected);
  out.schema_version = toInt(c.schema_version, 1);

  // ---- auth -------------------------------------------------------------
  out.username = str(pick(c, 'username') ?? authO.username);
  out.password = str(pick(c, 'password') ?? authO.password);
  out.uuid = str(c.uuid ?? '00000000-0000-0000-0000-000000000000');
  out.v2ray_uuid = str(pick(c, 'v2ray_uuid') ?? authO.v2ray_uuid);
  out.auth = {
    username: out.username,
    password: out.password,
    v2ray_uuid: out.v2ray_uuid,
  };

  // ---- servidor ---------------------------------------------------------
  const host = str(pick(c, 'server_host', 'servers', 'hosts', 'host') ?? srv.host);
  const port = toInt(pick(c, 'server_port', 'port') ?? srv.port, 8000);
  out.server_host = host;
  out.server_port = port;
  out.host = host;
  out.port = port;
  out.server = host;
  // "servers"/"hosts": no fornecedor 'servers' = host SSH e 'hosts' = host do proxy

  // ---- proxy ------------------------------------------------------------
  const pxy = splitProxy(c);
  const proxyHost = str(pxy.host || pxyO.host);
  const proxyPort = toInt(pxy.port || pxyO.port, 0);
  out.proxy_host = proxyHost;
  out.proxy_port = proxyPort;
  out.proxy = proxyHost ? [`${proxyHost}:${proxyPort}`] : arr(c.proxy);

  // ---- dns --------------------------------------------------------------
  const dnsArr = arr(c.dns).map(String);
  const dns1 = str(pick(c, 'dns1') ?? dnsO.dns1 ?? dnsArr[0] ?? '8.8.8.8');
  const dns2 = str(pick(c, 'dns2') ?? dnsO.dns2 ?? dnsArr[1] ?? dnsArr[0] ?? '8.8.4.4');
  out.dns1 = dns1;
  out.dns2 = dns2;
  out.dns_server = dns1;
  out.dns_servers = [dns1, dns2].filter(Boolean);
  out.dns_ms = toInt(c.dns_ms, 0);

  // ---- udp --------------------------------------------------------------
  out.udp_ports = arr(c.udp_ports).map(Number).filter((n) => Number.isFinite(n));
  out.udp_servers = arr(c.udp_servers).map(String);

  // ---- tls / payload ----------------------------------------------------
  out.tls_version = str(pick(c, 'tls_version', 'tls') ?? 'TLSv1.2');
  out.sni = str(pick(c, 'sni') ?? pay.sni);
  out.payload = str(pick(c, 'payload') ?? pay.payload);
  out.config_payload = { payload: out.payload, sni: out.sni };
  out.config_v2ray = (c.config_v2ray === undefined || c.config_v2ray === null)
    ? '' : (typeof c.config_v2ray === 'string' ? c.config_v2ray : JSON.stringify(c.config_v2ray));
  out.v2ray = out.config_v2ray;

  // ---- dnstt ------------------------------------------------------------
  out.dnstt_server = str(c.dnstt_server);
  out.dnstt_name_server = str(c.dnstt_name_server);
  out.dnstt_key = str(c.dnstt_key);

  // ---- bhttp ------------------------------------------------------------
  out.bhttp_config = (c.bhttp_config === undefined || c.bhttp_config === null)
    ? '' : (typeof c.bhttp_config === 'string' ? c.bhttp_config : JSON.stringify(c.bhttp_config));
  out.capability_probe = toBool(c.capability_probe);
  out.chunk_size = toInt(c.chunk_size, 0);
  out.batch_mode = str(c.batch_mode);
  out.batch_size = toInt(c.batch_size, 0);
  out.max_attempts = toInt(c.max_attempts, 0);
  out.connect_ms = toInt(c.connect_ms, 0);
  out.read_ms = toInt(c.read_ms, 0);
  out.shutdown_ms = toInt(c.shutdown_ms, 0);
  out.probe_ms = toInt(c.probe_ms, 0);
  out.requests_per_connection = toInt(c.requests_per_connection, 0);
  out.responses_per_request = toInt(c.responses_per_request, 0);
  out.retry_backoff_ms = toInt(c.retry_backoff_ms, 0);
  out.coalesce_ms = toInt(c.coalesce_ms, 0);
  out.timeouts = obj(c.timeouts);

  // ---- hysteria ---------------------------------------------------------
  out.hy_port = str(c.hy_port);
  out.hy_obfs = str(c.hy_obfs);
  out.hy_up_mbps = toInt(c.hy_up_mbps, 0);
  out.hy_down_mbps = toInt(c.hy_down_mbps, 0);
  out.hy_insecure = toBool(c.hy_insecure);
  out.hy_version = toInt(c.hy_version, 0);

  // ---- dt ---------------------------------------------------------------
  out.dt_protocol = str(pick(c, 'dt_protocol', 'proto') ?? 'TCP');
  out.dt_port = str(c.dt_port ?? c.port_alt ?? out.port);

  // ---- digest / signatures ----------------------------------------------
  // campos do schema nativo; o app valida a assinatura do reply e o digest
  // do bundle. Vem do servidor (chaves publicas do backend).
  out.digest = str(c.digest);
  out.signatures = c.signatures === undefined ? [] : c.signatures;

  // ---- textuais ---------------------------------------------------------
  out.text = str(c.text);
  out.label = str(c.label);
  out.entries = arr(c.entries);
  out.values = arr(c.values);
  out.value = str(c.value);

  return out;
}

function toNative(configs) {
  return (configs || []).map(build);
}

const NATIVE_FIELDS = Object.keys(build({}));

module.exports = { build, toNative, toInt, NATIVE_FIELDS };
