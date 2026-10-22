'use strict';
/**
 * Carrega e salva os JSONs editaveis do painel.
 * Por padrao usa a mesma pasta de dados do servidor Python (backup),
 * assim ambos leem exatamente os mesmos arquivos.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// o caminho padrao e' RELATIVO ao pacote (funciona em qualquer maquina).
// antes apontava para '/home/wellington/work/server' (caminho de dev) e o
// servidor caia em "ENOENT: server.key" quando as vars de ambiente nao
// eram passadas (ex.: quando o PM2 sobe o processo).
const DATA_DIR = process.env.DT_DATA_DIR || path.join(ROOT, 'data');
const SERVER_DIR = process.env.DT_SERVER_DIR || path.join(ROOT, 'keys');

const FILES = {
  configs: 'configs.json',
  categories: 'categories.json',
  cdns: 'cdns.json',
  app_configs: 'app_configs.json',
  texts: 'texts.json',
};

function filePath(key) {
  const name = FILES[key];
  if (!name) throw new Error(`arquivo desconhecido: ${key}`);
  return path.join(DATA_DIR, name);
}

function readJSON(key) {
  const p = filePath(key);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function writeJSON(key, data) {
  const p = filePath(key);
  // backup da versao anterior
  try {
    fs.copyFileSync(p, p + '.bak');
  } catch (_) {}
  fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
  return { path: p, bytes: fs.statSync(p).size };
}

function stat(key) {
  const p = filePath(key);
  const s = fs.statSync(p);
  return { name: FILES[key], path: p, size: s.size, mtime: s.mtime.toISOString() };
}

function listAll() {
  const out = {};
  for (const key of Object.keys(FILES)) {
    try {
      out[key] = stat(key);
    } catch (e) {
      out[key] = { name: FILES[key], error: e.message };
    }
  }
  return out;
}

module.exports = { ROOT, DATA_DIR, SERVER_DIR, FILES, readJSON, writeJSON, stat, listAll, filePath };
