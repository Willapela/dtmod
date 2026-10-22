'use strict';
/**
 * Painel web para editar os JSONs servidos pelo gRPC.
 * API REST + UI estatica.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const data = require('./data');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PANEL_PASSWORD = process.env.DT_PANEL_PASSWORD || 'dtunnel';
const PORT = process.env.DT_PANEL_PORT || '4000';
const HOST = process.env.DT_PANEL_HOST || '0.0.0.0';
const AUTH_FILE = () => path.join(data.DATA_DIR, 'panel_auth.json');
const SESSION_COOKIE = 'dtpanel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

function readPanelAuth() {
  try {
    const obj = JSON.parse(fs.readFileSync(AUTH_FILE(), 'utf8'));
    if (obj && obj.salt && obj.hash) return obj;
  } catch (_) {}
  return null;
}

function hashPanelPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verifyPanelPassword(password) {
  const stored = readPanelAuth();
  if (!stored) return String(password) === PANEL_PASSWORD;
  try {
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = Buffer.from(hashPanelPassword(password, stored.salt), 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

function writePanelPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const payload = {
    algo: 'scrypt',
    salt,
    hash: hashPanelPassword(password, salt),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(AUTH_FILE(), JSON.stringify(payload, null, 1), { mode: 0o600 });
  return payload;
}

function parseBasic(header) {
  const raw = String(header || '');
  if (!raw.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hasValidSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function createSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function startPanel(opts = {}) {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // --- autenticacao simples (Basic) ---
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (hasValidSession(req)) return next();
    const cred = parseBasic(req.headers.authorization);
    if (cred && cred.user === 'panel' && verifyPanelPassword(cred.pass)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="DTunnel Panel"');
    res.status(401).json({ error: 'nao autorizado' });
  });

  // arquivos estaticos (depois do auth)
  app.use(express.static(PUBLIC_DIR));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, dataDir: data.DATA_DIR });
  });

  app.get('/api/auth/state', (req, res) => {
    const stored = readPanelAuth();
    res.json({
      user: 'panel',
      custom: !!stored,
      updatedAt: stored ? stored.updatedAt || null : null,
    });
  });

  app.post('/api/auth/change', (req, res) => {
    const body = req.body || {};
    const atual = body.current;
    const nova = body.newPassword;
    if (!verifyPanelPassword(atual)) {
      return res.status(400).json({ error: 'senha atual incorreta' });
    }
    if (typeof nova !== 'string' || nova.length < 4) {
      return res.status(400).json({ error: 'a nova senha precisa ter pelo menos 4 caracteres' });
    }
    if (nova.length > 128) {
      return res.status(400).json({ error: 'a nova senha deve ter no maximo 128 caracteres' });
    }
    try {
      writePanelPassword(nova);
      const token = createSession();
      res.setHeader('Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
      console.log('[panel] senha do painel alterada');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'nao foi possivel salvar a nova senha: ' + e.message });
    }
  });

  // exporta as conexoes em JSON (formato da API oficial do DTunnel)
  app.get('/api/configs/export', (req, res) => {
    try {
      const codec = require('./config-codec');
      const list = data.readJSON('configs');
      const formato = (req.query.formato || 'api').toLowerCase();
      if (formato === 'app') {
        // flat: converte os itens aninhados para o formato que o app le
        return res.json(codec.listFromApi(list));
      }
      res.json(codec.listToApi(list));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // importa conexoes de um JSON (formato da API oficial OU o plano do app)
  app.post('/api/configs/import', (req, res) => {
    try {
      const codec = require('./config-codec');
      let payload = req.body;
      if (payload && payload.data !== undefined) payload = payload.data;
      if (!Array.isArray(payload)) {
        return res.status(400).json({ error: 'envie uma lista JSON de conexoes' });
      }
      // detecta o formato: a API oficial tem server/proxy/dns_server aninhados
      const apiFmt = payload.some((c) => c && (c.server || c.proxy || c.dns_server || c.config_payload));
      const list = apiFmt ? codec.listFromApi(payload) : payload;
      const atual = data.readJSON('configs');
      const force = !!(req.body && req.body.force);
      let merged = list;
      if (!force) {
        // preserva as que ja existem pelo id e completa as novas
        merged = list.map((c) => {
          const antigo = atual.find((a) => a.id && c.id && a.id === c.id);
          return antigo ? Object.assign({}, antigo, c) : c;
        });
      }
      const normal = merged.map((c) => codec.normalize(c));
      const info = data.writeJSON('configs', normal);
      // sincroniza as categorias (o app agrupa as conexoes por category_id)
      const cats = codec.syncCategories(normal, data.readJSON('categories'));
      data.writeJSON('categories', cats);
      console.log(`[panel] ${merged.length} conexoes importadas (formato ${apiFmt ? 'api' : 'app'})`);
      res.json({ ok: true, count: merged.length, formato: apiFmt ? 'api' : 'app', ...info });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // schema de edicao das conexoes (campos por modo de conexao)
  app.get('/api/config-schema', (req, res) => {
    res.json(require('./config-schema').schema());
  });

  app.get('/api/files', (req, res) => {
    res.json(data.listAll());
  });

  // log do servidor gRPC
  app.get('/api/logs', (req, res) => {
    const logFile = process.env.DT_LOG_FILE || '/tmp/srv_remote.log';
    try {
      const lines = fs.readFileSync(logFile, 'utf8').split('\n');
      const n = Math.min(parseInt(req.query.n, 10) || 200, 2000);
      res.json({ file: logFile, lines: lines.slice(-n) });
    } catch (e) {
      res.json({ file: logFile, lines: [], error: e.message });
    }
  });

  // status geral
  app.get('/api/status', (req, res) => {
    const out = { dataDir: data.DATA_DIR, files: data.listAll(), panelPort: Number(PORT) };
    try {
      const { execSync } = require('child_process');
      const grpcPort = String(process.env.GRPC_PORT || '443');
      out.grpcPort = Number(grpcPort) || 443;
      out.grpc = execSync(`ss -tln 2>/dev/null | grep -E ':${grpcPort}( |$)' || true`).toString().trim();
    } catch (_) {}
    res.json(out);
  });

  app.get('/api/:key', (req, res) => {
    try {
      res.json({ key: req.params.key, data: data.readJSON(req.params.key) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/:key', (req, res) => {
    const { key } = req.params;
    try {
      if (!data.FILES[key]) return res.status(400).json({ error: 'arquivo desconhecido' });
      const body = req.body;
      const payload = body && body.data !== undefined ? body.data : body;
      if (!Array.isArray(payload)) {
        return res.status(400).json({ error: 'o arquivo precisa ser uma lista JSON (array)' });
      }
      // protecao: nao aceita array vazio (evita apagar tudo por engano)
      if (payload.length === 0) {
        const current = data.readJSON(key);
        if (Array.isArray(current) && current.length > 0) {
          return res.status(400).json({
            error: `recusado: o arquivo tem ${current.length} itens. Envie "force": true para limpar de verdade.`,
          });
        }
      }
      const force = !!(body && body.force);
      // configs sempre no formato da API oficial (aninhado), como no painel original
      const toSave = key === 'configs'
        ? payload.map((c) => require('./config-codec').normalize(c))
        : payload;
      const info = data.writeJSON(key, toSave);
      // as categorias das conexoes precisam existir, senao o app nao mostra
      // nenhuma config (ele agrupa por category_id)
      if (key === 'configs' && Array.isArray(toSave)) {
        const codec = require('./config-codec');
        const cats = codec.syncCategories(toSave, data.readJSON('categories'));
        data.writeJSON('categories', cats);
      }
      console.log(`[panel] ${key} salvo (${payload.length} itens, ${info.bytes} bytes)`);
      res.json({ ok: true, ...info, count: payload.length, force });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // restaura a ultima versao (.bak)
  app.post('/api/:key/restore', (req, res) => {
    const { key } = req.params;
    try {
      const p = data.filePath(key);
      const bak = p + '.bak';
      if (!fs.existsSync(bak)) return res.status(400).json({ error: 'sem backup disponivel' });
      const content = fs.readFileSync(bak, 'utf8');
      JSON.parse(content); // valida
      fs.writeFileSync(p, content, 'utf8');
      const n = JSON.parse(content).length;
      console.log(`[panel] ${key} restaurado do backup (${n} itens)`);
      res.json({ ok: true, count: n });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // busca em qualquer campo
  app.post('/api/:key/search', (req, res) => {
    try {
      const rows = data.readJSON(req.params.key);
      const q = String((req.body && req.body.q) || '').toLowerCase();
      if (!q) return res.json({ results: rows });
      const results = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      res.json({ results });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(PORT, HOST, () => {
      const senha = readPanelAuth() ? 'definida no painel' : PANEL_PASSWORD;
      console.log(`[panel] painel web em http://${HOST}:${PORT} (user: panel / pass: ${senha})`);
      resolve(server);
    });
  });
}

module.exports = { startPanel, PANEL_PASSWORD, PORT };
