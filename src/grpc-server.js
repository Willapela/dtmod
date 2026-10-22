'use strict';
/**
 * Servidor gRPC (TLS) do DTunnel - reimplementacao em Node.js do server.py.
 * Serviços: ConfigService, AppConfigService, TextService, DeviceService.
 *
 * API do grpc-js para handlers unary:
 *   handler(stream, callback)
 *     - callback(null, value, metadata) envia a resposta e os trailing metadata
 *       (o 3o argumento vira o trailer gRPC, igual ao set_trailing_metadata do Python)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { ReplySigner } = require('./signer');

const PROTO_DIR = path.resolve(__dirname, '..', 'protos');
const SERVER_DIR = process.env.DT_SERVER_DIR || path.join(path.resolve(__dirname, '..'), 'keys');

const packageDefinition = protoLoader.loadSync(
  ['config.proto', 'appconfig.proto', 'text.proto', 'device.proto'],
  {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_DIR],
  }
);
const proto = grpc.loadPackageDefinition(packageDefinition);

const DEFS = {
  ConfigService: proto.com.app.config.ConfigService.service,
  AppConfigService: proto.com.app.appConfig.AppConfigService.service,
  TextService: proto.com.app.appText.TextService.service,
  DeviceService: proto.com.app.device.DeviceService.service,
};

function loadData() {
  const d = require('./data');
  const codec = require('./config-codec');
  const { toNative } = require('./native');
  // configs.json fica em formato CRU (editavel no painel); o app espera o
  // schema nativo -> convertemos na leitura.
  const rawConfigs = d.readJSON('configs');
  return {
    // o arquivo pode estar no formato aninhado (API oficial) ou plano (app);
    // se estiver aninhado, convertemos para plano antes de montar o nativo
    // o app oficial desserializa o item no formato do MODELO dele
    // (serverHost, proxyHost, dnsServers, udpServer, ...). O native.js gera
    // esse formato + os equivalentes planos.
    CONFIGS: toNative(codec.listFromApi(rawConfigs)),
    RAW_CONFIGS: rawConfigs,
    CATEGORIES: d.readJSON('categories'),
    CDNS: d.readJSON('cdns'),
    APPCONFIGS: d.readJSON('app_configs'),
    TEXTS: d.readJSON('texts'),
  };
}

function toInt(v, dflt = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function cfgValue(item) {
  const t = (item.type || '').toUpperCase();
  const v = item.value;
  if (t === 'BOOLEAN' || typeof v === 'boolean') return { boolValue: !!v };
  if (t === 'INTEGER' || typeof v === 'number') return { intValue: toInt(v, 0) };
  if (typeof v === 'string') return { stringValue: v };
  return { stringValue: JSON.stringify(v) };
}

function startGrpc(opts = {}) {
  const port = String(opts.port || '443');   // string: concatenarcia
  const signer = opts.signer || new ReplySigner(null, SERVER_DIR);
  // Os JSONs sao lidos A CADA request: editar no painel (ou no arquivo) ja
  // vale na proxima chamada, sem reiniciar o servidor.
  const fresh = () => loadData();
  let tick = 0;
  const nextHash = (base) => {
    tick += 1;
    return crypto.createHash('sha256').update(`${base}${Date.now()}${tick}`).digest('hex');
  };

  /** constroi um Metadata gRPC a partir de pares [key, value] usando .set() */
  const toMetadata = (pairs) => {
    const md = new grpc.Metadata();
    for (const [k, v] of pairs) md.set(k, v);
    return md;
  };

  const logCtx = (kind, stream) => {
    const out = {};
    for (const [k, v] of Object.entries(stream.metadata.getMap())) {
      out[k] = Buffer.isBuffer(v) ? `<${v.length} bytes>` : v;
    }
    console.log(`${kind} called | md=${JSON.stringify(out)}`);
  };

  const configService = {
    GetConfig(stream, callback) {
      try {
        logCtx('ConfigService.GetConfig', stream);
        const data = fresh();
        const mode = process.env.DATA_MODE || 'array';
        // o app exige "udpServers" na conexao (r43.B). Sem lista nao-vazia
        // ele aborta com "Missing udpServers". Preenchemos com os endpoints
        // (CDN) do servico, no formato host:porta.
        const endpoints = (data.CDNS || [])
          .map((e) => e.value)
          .filter(Boolean)
          .map((v) => (String(v).includes(':') ? String(v) : `${v}:443`));
        for (const cfg of data.CONFIGS) {
          if (!Array.isArray(cfg.udp_servers) || !cfg.udp_servers.length) {
            cfg.udp_servers = endpoints;
          }
        }
        const CONFIG_JSON = JSON.stringify(data.CONFIGS);
        let payload = CONFIG_JSON;
        if (mode === 'object') {
          payload = JSON.stringify({
            configs: data.CONFIGS,
            categories: data.CATEGORIES,
            endpoints: data.CDNS,
          });
        } else if (mode === 'b64') {
          payload = Buffer.from(CONFIG_JSON, 'utf8').toString('base64');
        }
        const t = signer.trailers('GetConfig', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { data: payload }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] GetConfig erro:', e);
        callback(e);
      }
    },
    getCategories(stream, callback) {
      try {
        logCtx('ConfigService.getCategories', stream);
        const data = fresh();
        const items = data.CATEGORIES.map((c) => ({
          id: toInt(c.id),
          name: c.name || '',
          color: c.color || '',
          order: toInt(c.order, 0),
        }));
        const t = signer.trailers('getCategories', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { data: items }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] getCategories erro:', e);
        callback(e);
      }
    },
    getEndpoints(stream, callback) {
      try {
        logCtx('ConfigService.getEndpoints', stream);
        const data = fresh();
        const items = data.CDNS.map((e) => ({
          id: String(e.id),
          name: e.name || '',
          type: e.type || '',
          value: e.value || '',
        }));
        const t = signer.trailers('getEndpoints', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { data: items }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] getEndpoints erro:', e);
        callback(e);
      }
    },
    getHash(stream, callback) {
      try {
        logCtx('ConfigService.getHash', stream);
        const data = fresh();
        const CONFIG_HASH = crypto.createHash('sha256')
          .update(JSON.stringify(data.CONFIGS)).digest('hex');
        const t = signer.trailers('getHash', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { hash: nextHash(CONFIG_HASH) }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] getHash erro:', e);
        callback(e);
      }
    },
  };

  const textService = {
    getTexts(stream, callback) {
      try {
        logCtx('TextService.getTexts', stream);
        const data = fresh();
        const texts = data.TEXTS.map((t) => ({ label: t.label || '', text: t.text || '' }));
        const tr = signer.trailers('getTexts', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { texts }, tr.length ? toMetadata(tr) : null);
      } catch (e) {
        console.error('[grpc] getTexts erro:', e);
        callback(e);
      }
    },
    getHash(stream, callback) {
      try {
        logCtx('TextService.getHash', stream);
        const data = fresh();
        const h = crypto.createHash('sha256').update(JSON.stringify(data.TEXTS)).digest('hex');
        const t = signer.trailers('getHash', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { hash: nextHash(h) }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] getText hash erro:', e);
        callback(e);
      }
    },
  };

  const appConfigService = {
    GetAppConfig(stream, callback) {
      try {
        logCtx('AppConfigService.GetAppConfig', stream);
        const data = fresh();
        const items = data.APPCONFIGS.map((it) => {
          const name = it.name || it.key || '';
          const item = { name, type: it.type || '' };
          const v = cfgValue(it);
          if (v.boolValue !== undefined) item.boolValue = v.boolValue;
          else if (v.intValue !== undefined) item.intValue = v.intValue;
          else item.stringValue = v.stringValue;
          return item;
        });
        const t = signer.trailers('GetAppConfig', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { data: items }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] GetAppConfig erro:', e);
        callback(e);
      }
    },
    getHash(stream, callback) {
      try {
        logCtx('AppConfigService.getHash', stream);
        const data = fresh();
        const h = crypto.createHash('sha256').update(JSON.stringify(data.APPCONFIGS)).digest('hex');
        const t = signer.trailers('getHash', stream.metadata.get('x-dtunnel-nonce-bin')[0]);
        callback(null, { hash: nextHash(h) }, t.length ? toMetadata(t) : null);
      } catch (e) {
        console.error('[grpc] AppConfig hash erro:', e);
        callback(e);
      }
    },
  };

  const deviceService = {
    SaveDevice: (stream, cb) => { logCtx('DeviceService.SaveDevice', stream); cb(null, {}); },
    SaveUsername: (stream, cb) => { logCtx('DeviceService.SaveUsername', stream); cb(null, {}); },
    SaveFcmToken: (stream, cb) => { logCtx('DeviceService.SaveFcmToken', stream); cb(null, {}); },
    UpdateLastSeen: (stream, cb) => { logCtx('DeviceService.UpdateLastSeen', stream); cb(null, {}); },
    UpdateLocation: (stream, cb) => { logCtx('DeviceService.UpdateLocation', stream); cb(null, {}); },
  };

  process.on('uncaughtException', (e) => console.error('[grpc] uncaught:', e));
  process.on('unhandledRejection', (e) => console.error('[grpc] unhandled:', e));

  // TLS ou plaintext. DT_TLS:
  //   1 = so TLS, 0 = so h2c (plaintext), auto = os dois na MESMA porta.
  // Com "auto" o servidor snifa os primeiros bytes de cada conexao: se
  // comecar com 0x16 (TLS handshake) vai pro listener TLS, senao (h2c,
  // preface "PRI * HTTP/2.0") vai pro listener plaintext. Assim o mesmo
  // servidor atende o APK compilado COM ou SEM certificado - nao importa
  // como o app foi compilado.
  const tlsMode = (process.env.DT_TLS || '1').toLowerCase();
  const useTls = tlsMode !== '0';
  const usePlain = tlsMode !== '1';
  const auto = useTls && usePlain;

  function makeCreds(tls) {
    if (!tls) return grpc.ServerCredentials.createInsecure();
    const key = fs.readFileSync(path.join(SERVER_DIR, 'server.key'));
    const cert = fs.readFileSync(path.join(SERVER_DIR, 'server.pem'));
    return grpc.ServerCredentials.createSsl(null, [{ private_key: key, cert_chain: cert }], false);
  }

  const servers = [];
  // parseInt evita o bug classico: se o port vier como string, "8443" + 100
  // daria "8443100" em vez de 8543.
  const PUBLIC_PORT = Number(String(port).replace(/[^0-9]/g, '')) || 443;
  const bindOne = (tls, listenPort, label) => {
    const s = new grpc.Server();
    s.addService(DEFS.ConfigService, configService);
    s.addService(DEFS.TextService, textService);
    s.addService(DEFS.AppConfigService, appConfigService);
    s.addService(DEFS.DeviceService, deviceService);
    s.bindAsync(`0.0.0.0:${listenPort}`, makeCreds(tls), (err) => {
      if (err) {
        console.error(`[grpc] falha ao vincular (${label}):`, err.message);
        process.exit(1);
      }
      console.log(
        `[grpc] gRPC ${label} server listening on 0.0.0.0:${listenPort}`
      );
    });
    servers.push(s);
    return s;
  };

  if (auto) {
    // 2 listeners internos (TLS e h2c) + 1 sniffer na porta publica.
    // As portas internas sao derivadas da publica (port+100 e port+200)
    // para nao colidir com a publica nem com portas comuns.
    const IN_TLS = Number(process.env.DT_TLS_PORT_INTERNAL || PUBLIC_PORT + 100);
    const IN_PLAIN = Number(process.env.DT_TLS_PORT_INTERNAL2 || PUBLIC_PORT + 200);
    bindOne(true, IN_TLS, 'TLS');
    bindOne(false, IN_PLAIN, 'PLAINTEXT');
    const sniffer = net.createServer((sock) => {
      sock.once('data', (chunk) => {
        const isTls = chunk.length > 0 && chunk[0] === 0x16;
        const upstream = net.connect({ port: isTls ? IN_TLS : IN_PLAIN, host: '127.0.0.1' },
          () => {
            upstream.write(chunk);
            sock.pipe(upstream);
            upstream.pipe(sock);
          });
        upstream.on('error', () => sock.destroy());
        sock.on('error', () => upstream.destroy());
      });
    });
    sniffer.listen(PUBLIC_PORT, '0.0.0.0', () => {
      console.log(`[grpc] gRPC AUTO (TLS + h2c) na porta ${PUBLIC_PORT} (TLS=${IN_TLS}, h2c=${IN_PLAIN})`);
    });
  } else {
    bindOne(useTls, port, useTls ? 'TLS' : 'PLAINTEXT');
  }

  setTimeout(() => {
    const d = fresh();
    console.log(
      `[grpc] dados: ${d.CONFIGS.length} conexoes | ${d.CATEGORIES.length} categorias | ` +
      `${d.CDNS.length} endpoints | ${d.APPCONFIGS.length} app_configs | ${d.TEXTS.length} texts`
    );
  }, 500);

  return { server: servers[0], servers, auto };
}

module.exports = { startGrpc, loadData, DEFS };
