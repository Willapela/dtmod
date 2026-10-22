'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { X509Certificate } = require('crypto');
const data = require('./data');

const ROOT = path.resolve(__dirname, '..');
const FETCH_SCRIPT = path.join(ROOT, 'apk-build', 'fetch-package.sh');
const PACKAGE_DIR = path.join(ROOT, 'apk-build', '.work', 'dtunnel-mod');
const OUTPUT_FILE = path.join(PACKAGE_DIR, 'dist', 'dt_patched_signed.apk');
const MAX_LOG_CHARS = 24000;
const MAX_APK_BYTES = 200 * 1024 * 1024;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 30000;
let lastStartedAt = 0;

const state = {
  running: false,
  jobId: null,
  host: null,
  port: null,
  startedAt: null,
  finishedAt: null,
  ok: false,
  output: '',
  error: null,
};

function appendOutput(chunk) {
  state.output += String(chunk);
  if (state.output.length > MAX_LOG_CHARS) state.output = state.output.slice(-MAX_LOG_CHARS);
}

function getGrpcPort() {
  const port = Number(process.env.GRPC_PORT || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('A porta gRPC configurada no servidor é inválida.');
  }
  return port;
}

function normalizeHost(value) {
  let host = String(value || '').trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host.length > 253 || /[\s/@?#\\]/.test(host)) return '';
  return host.toLowerCase();
}

function certificateHosts() {
  const certPath = path.join(data.SERVER_DIR, 'server.pem');
  if (!fs.existsSync(certPath)) throw new Error('Não encontrei server.pem em DT_SERVER_DIR.');
  const cert = new X509Certificate(fs.readFileSync(certPath));
  const alt = cert.subjectAltName || '';
  const hosts = [];
  for (const entry of alt.split(/,\s*/)) {
    const dns = entry.match(/^DNS:(.+)$/i);
    const ip = entry.match(/^IP Address:(.+)$/i);
    const candidate = normalizeHost(dns ? dns[1] : ip ? ip[1] : '');
    if (candidate && !hosts.includes(candidate)) hosts.push(candidate);
  }
  if (!hosts.length) throw new Error('O certificado do servidor não contém host SAN compatível para o APK.');
  return hosts;
}

function publicState() {
  let hosts = [];
  let port = null;
  let configError = null;
  try {
    hosts = certificateHosts();
    port = getGrpcPort();
  } catch (e) {
    configError = e.message;
  }
  return {
    hosts,
    port,
    configError,
    packageReady: fs.existsSync(path.join(PACKAGE_DIR, 'make_mod.sh')),
    running: state.running,
    jobId: state.jobId,
    host: state.host,
    targetPort: state.port,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    ok: state.ok,
    output: state.output,
    error: state.error,
    downloadReady: !state.running && state.ok && fs.existsSync(OUTPUT_FILE),
  };
}

function ensureNotSymlink(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('O caminho do pacote contém link simbólico; recusando usar esse diretório.');
  if (!stat.isDirectory()) throw new Error('O caminho do pacote não é um diretório.');
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(os.homedir(), 'Android', 'Sdk'),
    '/usr/lib/android-sdk',
    '/opt/android-sdk',
  ].filter(Boolean);
  for (const sdk of [...new Set(candidates)]) {
    const btRoot = path.join(sdk, 'build-tools');
    if (!fs.existsSync(btRoot)) continue;
    const versions = fs.readdirSync(btRoot)
      .filter((v) => fs.existsSync(path.join(btRoot, v, 'apksigner')) && fs.existsSync(path.join(btRoot, v, 'zipalign')))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (versions.length) return { root: sdk, buildTools: path.join(btRoot, versions[0]) };
  }
  throw new Error('Android SDK Build Tools não encontrados. Configure ANDROID_SDK_ROOT no serviço do painel.');
}

function runCommand(command, args, options, onChunk) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timeout = setTimeout(() => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { try { child.kill('SIGTERM'); } catch (_) {} }
        setTimeout(() => {
          try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
        }, 5000).unref();
      }
    }, BUILD_TIMEOUT_MS);
    timeout.unref();
    const consume = (stream, prefix) => stream.on('data', (chunk) => onChunk(prefix + chunk.toString()));
    consume(child.stdout, '');
    consume(child.stderr, '');
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function preparePackage() {
  if (!fs.existsSync(path.join(PACKAGE_DIR, 'make_mod.sh'))) {
    if (!fs.existsSync(FETCH_SCRIPT)) throw new Error('Pacote de build não encontrado. Reimplante o repositório com apk-build/fetch-package.sh.');
    appendOutput('[build] Baixando pacote fixado e verificando SHA-256…\n');
    const result = await runCommand('bash', [FETCH_SCRIPT], { cwd: ROOT, env: process.env }, appendOutput);
    if (result.code !== 0 || !fs.existsSync(path.join(PACKAGE_DIR, 'make_mod.sh'))) {
      throw new Error('Não foi possível preparar o pacote de build. Confira a saída do job.');
    }
  }
  ensureNotSymlink(PACKAGE_DIR);

  const caPath = path.join(data.SERVER_DIR, 'ca.pem');
  const publicKeyPath = path.join(data.SERVER_DIR, 'server_reply_key.json');
  if (!fs.existsSync(caPath) || !fs.existsSync(publicKeyPath)) {
    throw new Error('Faltam ca.pem ou server_reply_key.json em DT_SERVER_DIR; o build não copiará nem pedirá a chave privada.');
  }
  const packageKeys = path.join(PACKAGE_DIR, 'keys');
  fs.mkdirSync(packageKeys, { recursive: true });
  fs.copyFileSync(caPath, path.join(packageKeys, 'ca.pem'));
  fs.copyFileSync(publicKeyPath, path.join(packageKeys, 'server_reply_key.json'));

  const sdk = findAndroidSdk();
  const apktool = process.env.APKTOOL || path.join(os.homedir(), 'tools', 'apktool', 'apktool.jar');
  if (!fs.existsSync(apktool)) {
    throw new Error('Apktool JAR não encontrado. Instale-o em ~/tools/apktool/apktool.jar ou configure APKTOOL no serviço.');
  }
  return { sdk, apktool };
}

async function executeBuild(host, port) {
  try {
    const { sdk, apktool } = await preparePackage();
    try { fs.rmSync(OUTPUT_FILE, { force: true }); } catch (_) {}
    const env = {
      ...process.env,
      ANDROID_SDK_ROOT: sdk.root,
      ANDROID_HOME: sdk.root,
      APKTOOL: apktool,
      PATH: `${sdk.buildTools}:${path.join(sdk.root, 'platform-tools')}:${process.env.PATH || ''}`,
    };
    appendOutput(`[build] Iniciando APK para ${host}:${port}\n`);
    const result = await runCommand('bash', ['./make_mod.sh', host, String(port)], {
      cwd: PACKAGE_DIR,
      env,
    }, appendOutput);
    if (result.code !== 0) {
      throw new Error(result.signal ? `Build interrompido pelo sinal ${result.signal}.` : `Build terminou com código ${result.code}.`);
    }
    const stat = fs.statSync(OUTPUT_FILE);
    if (!stat.isFile() || stat.size < 1024 * 1024 || stat.size > MAX_APK_BYTES) {
      throw new Error('O APK gerado está ausente ou tem tamanho inesperado.');
    }
    const fd = fs.openSync(OUTPUT_FILE, 'r');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    if (magic.toString('hex') !== '504b0304') throw new Error('O arquivo de saída não parece ser um APK ZIP válido.');
    state.ok = true;
    appendOutput(`[build] Concluído: ${Math.round(stat.size / 1024 / 1024)} MB\n`);
  } catch (e) {
    state.ok = false;
    state.error = e.message;
    appendOutput(`[erro] ${e.message}\n`);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}

function getStatus(req, res) {
  res.json(publicState());
}

function startBuild(req, res) {
  let port;
  let hosts;
  try {
    port = getGrpcPort();
    hosts = certificateHosts();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const host = normalizeHost(req.body && req.body.host);
  if (!host || !hosts.includes(host)) {
    return res.status(400).json({ error: 'Selecione um host incluído no certificado TLS deste servidor.' });
  }
  if (!req.body || req.body.acknowledge !== true) {
    return res.status(400).json({ error: 'Confirme o aviso de segurança antes de iniciar o build.' });
  }
  if (state.running) return res.status(409).json({ error: 'Já existe um build em andamento.' });
  if (Date.now() - lastStartedAt < COOLDOWN_MS) {
    return res.status(429).json({ error: 'Aguarde 30 segundos antes de iniciar outro build.' });
  }

  lastStartedAt = Date.now();
  state.running = true;
  state.jobId = crypto.randomUUID();
  state.host = host;
  state.port = port;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.ok = false;
  state.output = '';
  state.error = null;
  setImmediate(() => executeBuild(host, port));
  return res.status(202).json({ ok: true, jobId: state.jobId, message: 'Build iniciado.' });
}

function downloadApk(req, res) {
  if (state.running) return res.status(409).json({ error: 'O build ainda está em andamento.' });
  if (!state.ok || !fs.existsSync(OUTPUT_FILE)) return res.status(404).json({ error: 'Não há APK concluído para baixar.' });
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/vnd.android.package-archive');
  // O APK fica em .work; o send do Express ignora caminhos ocultos por padrão.
  return res.download(OUTPUT_FILE, 'dt_patched_signed.apk', { dotfiles: 'allow' });
}

module.exports = { getStatus, startBuild, downloadApk };
