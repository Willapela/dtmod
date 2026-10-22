/* Painel DTunnel - edicao dos JSONs servidos via gRPC */
(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  const TITLES = {
    configs: 'Conexões',
    categories: 'Categorias',
    cdns: 'Endpoints',
    app_configs: 'App Config',
    texts: 'Textos',
    logs: 'Logs',
  };

  const SUBTITLES = {
    configs: 'Gerencie as conexões entregues ao aplicativo.',
    categories: 'Organize as conexões em grupos visíveis no app.',
    cdns: 'Cadastre os domínios/CDNs usados como endpoints.',
    app_configs: 'Ajuste as chaves de configuração do aplicativo.',
    texts: 'Edite os textos exibidos na interface do app.',
    logs: 'Acompanhe o log do servidor gRPC em tempo real.',
  };

  const PRIMARY = {
    configs: 'name',
    categories: 'name',
    cdns: 'name',
    app_configs: 'name',
    texts: 'label',
  };

  const SUBTITLE = {
    configs: 'id',
    categories: 'id',
    cdns: 'value',
    app_configs: 'type',
    texts: 'text',
  };

  const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>';
  const ICON_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg>';
  const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/></svg>';

  let current = 'configs';
  let rows = [];
  let dirty = false;
  let schema = null;
  let categories = [];
  let cdns = [];
  const SCHEMA_FIELDS = new Map();
  let editIdx = null;
  let editorDraft = null;
  let editorIsNew = false;

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function fmt(v) {
    if (Array.isArray(v)) return v.join(', ');
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  const deepClone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  function getPath(obj, path) {
    if (!path || path.indexOf('.') < 0) return obj ? obj[path] : undefined;
    let cur = obj;
    for (const p of path.split('.')) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function setPath(obj, path, valor) {
    if (!path || path.indexOf('.') < 0) { obj[path] = valor; return; }
    const partes = path.split('.');
    let cur = obj;
    for (let i = 0; i < partes.length - 1; i++) {
      const p = partes[i];
      if (cur[p] === null || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[partes[partes.length - 1]] = valor;
  }

  function modeLabel(mode) {
    if (schema && schema.modes && schema.modes[mode]) return schema.modes[mode].label;
    return mode || '—';
  }

  function categoryOf(c) {
    const raw = c && c.category;
    const id = (c && c.category_id) ?? (raw && typeof raw === 'object' ? raw.id : undefined);
    const found = categories.find((x) => String(x.id) === String(id));
    const name = (raw && typeof raw === 'object' ? raw.name : raw) || (found && found.name) || '';
    const color = (raw && typeof raw === 'object' && raw.color) || (found && found.color) || '#5b8cff';
    return { id, name, color };
  }

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const a = (parts[0] || '?').charAt(0);
    const b = parts.length > 1 ? parts[1].charAt(0) : '';
    return (a + b).toUpperCase();
  }

  function endpointValue(entry) {
    const raw = String((entry && entry.value) || '').trim();
    if (!raw) return '';
    return raw.includes(':') ? raw : `${raw}:443`;
  }

  function normalizeEndpoint(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.includes(':') ? raw : `${raw}:443`;
  }

  function configSummary(c) {
    const out = [];
    const srv = c.server && typeof c.server === 'object' ? c.server : {};
    const host = srv.host || c.servers || c.host || (typeof c.server === 'string' ? c.server : '');
    const port = srv.port || c.port || '';
    if (host) out.push(port ? `${host}:${port}` : String(host));

    const proxy = c.proxy && typeof c.proxy === 'object' && !Array.isArray(c.proxy) ? c.proxy : {};
    const proxyHost = proxy.host || c.proxy_host || (Array.isArray(c.proxy) ? String(c.proxy[0] || '').split(':')[0] : '');
    const proxyPort = proxy.port || c.proxy_port || '';
    if (proxyHost) out.push(`proxy ${proxyPort ? `${proxyHost}:${proxyPort}` : proxyHost}`);

    const dns = c.dns_server && typeof c.dns_server === 'object' ? c.dns_server : {};
    const dns1 = dns.dns1 || c.dns1 || (Array.isArray(c.dns) ? c.dns[0] : '');
    if (dns1) out.push(`DNS ${dns1}`);

    const tls = c.tls_version || c.tls;
    if (tls) out.push(tls);

    const endpoints = Array.isArray(c.udp_servers) ? c.udp_servers.length : 0;
    if (endpoints) out.push(`${endpoints} endpoint${endpoints > 1 ? 's' : ''}`);

    return out;
  }

  function filtered() {
    const q = $('#search').value.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }

  function updateCount() {
    const list = filtered();
    const suffix = dirty ? ' • não salvo' : '';
    $('#count').textContent = `${list.length} de ${rows.length} itens${suffix}`;
  }

  async function loadStatus() {
    const el = $('#status');
    try {
      const s = await api('/api/status');
      const active = !!(s.grpc && String(s.grpc).trim());
      el.innerHTML = `<span class="dot ${active ? 'ok' : 'err'}"></span><span>${active ? 'gRPC ativo' : 'gRPC inativo'}</span>`;
      el.title = s.dataDir || '';
    } catch (e) {
      el.innerHTML = `<span class="dot err"></span><span>${esc(e.message)}</span>`;
      el.title = '';
    }
  }

  async function load() {
    if (current === 'logs') return loadLogs();
    $('#logs').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    try {
      if (current === 'configs') {
        const res = await Promise.allSettled([api('/api/categories'), api('/api/cdns')]);
        if (res[0].status === 'fulfilled') categories = res[0].value.data || [];
        if (res[1].status === 'fulfilled') cdns = res[1].value.data || [];
      }
      const { data } = await api(`/api/${current}`);
      rows = data;
      dirty = false;
      render();
    } catch (e) {
      rows = [];
      $('#editor').innerHTML = emptyState('Não foi possível carregar', e.message, false);
      $('#count').textContent = '';
      toast('Erro ao carregar: ' + e.message, 'err');
    }
  }

  async function loadLogs() {
    try {
      const { lines } = await api('/api/logs?n=300');
      $('#logs').textContent = (lines || []).join('\n') || '(sem logs)';
      $('#logs').scrollTop = $('#logs').scrollHeight;
      $('#editor').classList.add('hidden');
      $('#logs').classList.remove('hidden');
      $('#count').textContent = `${(lines || []).length} linhas`;
    } catch (e) {
      toast('Erro ao carregar logs: ' + e.message, 'err');
    }
  }

  function emptyState(title, text, withAction = true) {
    return `<div class="empty">
      <div class="empty-icon">${ICON_EMPTY}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${withAction ? '<button class="btn primary" data-new type="button">+ Criar agora</button>' : ''}
    </div>`;
  }

  function render() {
    $('#logs').classList.add('hidden');
    $('#editor').classList.remove('hidden');
    if (current === 'configs') renderConfigs();
    else renderGeneric();
  }

  function renderConfigs() {
    const list = filtered();
    updateCount();
    if (!rows.length) {
      $('#editor').innerHTML = emptyState('Nenhuma conexão', 'Crie a primeira conexão para o aplicativo receber na próxima atualização.');
      return;
    }
    if (!list.length) {
      $('#editor').innerHTML = emptyState('Nada encontrado', 'Ajuste o filtro para ver as conexões.', false);
      return;
    }

    $('#editor').innerHTML = list
      .map((row) => {
        const idx = rows.indexOf(row);
        const name = row.name || '(sem nome)';
        const mode = row.mode || row.type || '';
        const cat = categoryOf(row);
        const status = row.status || 'ACTIVE';
        const summary = configSummary(row);
        return `<article class="card conn" data-idx="${idx}">
          <div class="conn-avatar" style="--cat:${esc(cat.color)}">${esc(initials(name))}</div>
          <div class="conn-main">
            <div class="conn-title">
              <h3>${esc(name)}</h3>
              <span class="badge mode">${esc(modeLabel(mode))}</span>
              ${status !== 'ACTIVE' ? `<span class="badge ${status === 'DELETED' ? 'deleted' : 'inactive'}">${esc(status)}</span>` : ''}
            </div>
            <div class="chips">
              ${cat.name ? `<span class="chip"><i class="cat-dot" style="--cat:${esc(cat.color)}"></i>${esc(cat.name)}</span>` : ''}
              ${summary.map((item) => `<span class="chip"><code>${esc(item)}</code></span>`).join('')}
            </div>
          </div>
          <div class="conn-actions">
            <button class="icon-btn" data-edit="${idx}" type="button" title="Editar conexão">${ICON_EDIT}</button>
            <button class="icon-btn danger" data-del="${idx}" type="button" title="Excluir conexão">${ICON_TRASH}</button>
          </div>
        </article>`;
      })
      .join('');
  }

  function renderGeneric() {
    const list = filtered();
    updateCount();
    if (!rows.length) {
      $('#editor').innerHTML = emptyState('Nenhum item', 'Use o botão “+ Novo” para criar o primeiro item.');
      return;
    }
    if (!list.length) {
      $('#editor').innerHTML = emptyState('Nada encontrado', 'Ajuste o filtro para ver os itens.', false);
      return;
    }

    $('#editor').innerHTML = list
      .map((row) => {
        const idx = rows.indexOf(row);
        const title = row[PRIMARY[current]] ?? row.name ?? row.label ?? `#${idx}`;
        const sub = row[SUBTITLE[current]];
        return `<article class="card gen" data-idx="${idx}">
          <div class="gen-head">
            <div class="gen-title">
              <h3>${esc(title)}</h3>
              ${sub !== undefined && sub !== '' ? `<span class="chip">${esc(fmt(sub))}</span>` : ''}
            </div>
            <div class="gen-actions">
              <button class="icon-btn danger" data-del="${idx}" type="button" title="Excluir item">${ICON_TRASH}</button>
              <button class="icon-btn" type="button" title="Expandir" tabindex="-1">${ICON_CHEVRON}</button>
            </div>
          </div>
          <div class="gen-body">${fieldsHtml(row)}</div>
        </article>`;
      })
      .join('');
  }

  function fieldsHtml(row) {
    const keys = Object.keys(row).filter((k) => k !== 'id');
    return `<div class="form-grid">${keys.map((k) => cellHtml(row, k)).join('')}</div>`;
  }

  function cellHtml(row, key) {
    const value = row[key];
    const kind = Array.isArray(value) ? 'json' : value === null ? 'json' : typeof value;
    const wide = kind === 'json' || kind === 'object' ||
      (typeof value === 'string' && (value.includes('\n') || value.length > 70)) ||
      ['text', 'description', 'value', 'label'].includes(key);

    if (kind === 'boolean') {
      return `<label class="fld chk"><input type="checkbox" data-key="${esc(key)}" data-kind="bool" ${value ? 'checked' : ''}><span>${esc(key)}</span></label>`;
    }
    if (kind === 'json' || kind === 'object') {
      const text = value === undefined ? '' : JSON.stringify(value, null, 2);
      return `<label class="fld wide"><span>${esc(key)}</span><textarea data-key="${esc(key)}" data-kind="json" rows="${kind === 'object' ? 5 : 3}">${esc(text)}</textarea></label>`;
    }
    if (typeof value === 'string' && (value.includes('\n') || ['text', 'description'].includes(key) || value.length > 90)) {
      return `<label class="fld wide"><span>${esc(key)}</span><textarea data-key="${esc(key)}" data-kind="string" rows="3">${esc(value)}</textarea></label>`;
    }
    return `<label class="fld ${wide ? 'wide' : ''}"><span>${esc(key)}</span>
      <input type="${kind === 'number' ? 'number' : 'text'}" data-key="${esc(key)}" data-kind="${esc(kind)}" value="${esc(fmt(value))}">
    </label>`;
  }

  async function save() {
    if (current === 'logs') return false;
    try {
      const body = { data: rows };
      if (!rows.length && current !== 'logs') {
        if (!confirm('Você removeu todos os itens. Confirma apagar tudo?')) return false;
        body.force = true;
      }
      const r = await api(`/api/${current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      dirty = false;
      if (current === 'configs') {
        try { categories = (await api('/api/categories')).data || []; } catch (_) {}
      }
      render();
      toast(`Salvo no servidor: ${r.count} itens. O app recebe na próxima atualização.`, 'ok');
      return true;
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 'err');
      return false;
    }
  }

  async function add() {
    if (current === 'configs') {
      openEditor(-1);
      return;
    }
    if (current === 'categories') {
      rows.push({ id: nextCategoryId(), name: 'Nova categoria', color: '#5b8cff', sorter: rows.length + 1, status: 'ACTIVE' });
    } else if (current === 'cdns') {
      rows.push({ id: randomId(), name: 'Novo endpoint', value: '' });
    } else if (current === 'app_configs') {
      rows.push({ name: 'NOVO_ITEM', type: 'STRING', value: '' });
    } else if (current === 'texts') {
      rows.push({ label: 'NOVO_TEXTO', text: '' });
    }
    dirty = true;
    render();
    const card = $(`.card.gen[data-idx="${rows.length - 1}"]`);
    if (card) card.classList.add('open');
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return String(Date.now());
  }

  function nextCategoryId() {
    let id = Math.floor(Date.now() % 1000000);
    let guard = 0;
    while (categories.some((c) => String(c.id) === String(id)) && guard++ < 1000) {
      id = Math.floor(Math.random() * 1000000) + 1;
    }
    return id;
  }

  function nextConnectionId() {
    const used = new Set(rows.map((r) => String(r.id)));
    let id;
    do { id = Math.floor(Math.random() * 900000000) + 100000000; } while (used.has(String(id)));
    return id;
  }

  function deleteRow(idx) {
    const row = rows[idx];
    const label = row ? (row.name || row.label || row.value || `#${idx}`) : `#${idx}`;
    if (!confirm(`Excluir "${label}"?`)) return;
    rows.splice(idx, 1);
    dirty = true;
    render();
  }

  function fieldValue(c, f) {
    const vazio = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    for (const p of (f.paths || (f.path ? [f.path] : []))) {
      const v = getPath(c, p);
      if (!vazio(v)) return v;
    }
    for (const k of (f.keys || [f.k])) {
      const v = c[k];
      if (!vazio(v)) return v;
    }
    return '';
  }

  function fieldHtml(c, f) {
    const v = fieldValue(c, f);
    const id = `f_${f.k}`;
    let ft = f.t;
    if (ft === 'auto') {
      ft = typeof v === 'boolean' ? 'bool'
        : typeof v === 'number' ? 'number'
        : Array.isArray(v) ? 'json'
        : (v && typeof v === 'object') ? 'json'
        : 'text';
    }

    if (ft === 'bool') {
      return `<label class="fld chk"><input type="checkbox" id="${id}" data-k="${f.k}" ${v ? 'checked' : ''}><span>${esc(f.l)}</span></label>`;
    }

    if (ft === 'category') {
      const catObj = c && typeof c.category === 'object' ? c.category : null;
      const nomeAtual = catObj ? (catObj.name || '') : (typeof c.category === 'string' ? c.category : '');
      let catId = c && c.category_id ? c.category_id : (catObj && catObj.id);
      if (!catId && nomeAtual) {
        const byName = categories.find((cat) => cat.name === nomeAtual);
        if (byName) catId = byName.id;
      }
      const atual = String(catId ?? '');
      const opts = categories
        .map((cat) => `<option value="${esc(cat.id)}" ${String(cat.id) === String(atual) ? 'selected' : ''}>${esc(cat.name || ('#' + cat.id))}</option>`)
        .join('');
      const extra = atual && !categories.some((cat) => String(cat.id) === atual)
        ? `<option value="${esc(atual)}" selected>${esc(nomeAtual || ('#' + atual))}</option>` : '';
      return `<label class="fld wide">
        <span>${esc(f.l)}</span>
        <select id="${id}" data-k="${f.k}" data-cat="1">
          <option value="">— sem categoria —</option>
          ${extra}
          ${opts}
          <option value="__new__">＋ nova categoria…</option>
        </select>
        <input type="text" id="${id}_new" class="hidden" placeholder="nome da nova categoria">
      </label>`;
    }

    if (ft === 'select') {
      const opts = (f.opts || []).map((o) => `<option ${String(v) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('');
      const extra = v && !(f.opts || []).map(String).includes(String(v))
        ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : '';
      return `<label class="fld"><span>${esc(f.l)}</span><select id="${id}" data-k="${f.k}">${extra}${opts}</select></label>`;
    }

    if (ft === 'textarea') {
      return `<label class="fld wide"><span>${esc(f.l)}</span><textarea id="${id}" data-k="${f.k}" rows="3" placeholder="${esc(f.h || '')}">${esc(v ?? '')}</textarea></label>`;
    }

    if (ft === 'dns') {
      const d = Array.isArray(v) ? v.join('\n') : (v || '');
      return `<label class="fld wide"><span>${esc(f.l)}</span><textarea id="${id}" data-k="${f.k}" data-dns="1" rows="2" placeholder="${esc(f.h || '')}">${esc(d)}</textarea></label>`;
    }

    if (ft === 'password') {
      return `<label class="fld"><span>${esc(f.l)}</span>
        <div class="input-wrap">
          <input type="password" id="${id}" data-k="${f.k}" value="${esc(v ?? '')}" placeholder="${esc(f.h || '')}" autocomplete="new-password">
          <button class="reveal" type="button" data-reveal title="Mostrar/ocultar">${ICON_EYE}</button>
        </div>
      </label>`;
    }

    if (ft === 'json') {
      const text = v === undefined || v === null || v === '' ? '' : JSON.stringify(v, null, 2);
      return `<label class="fld wide"><span>${esc(f.l)}</span><textarea id="${id}" data-k="${f.k}" data-json="1" rows="4" placeholder="${esc(f.h || '')}">${esc(text)}</textarea></label>`;
    }

    if (ft === 'cdn') {
      const selected = Array.isArray(v) ? v.map(String) : (v ? [String(v)] : []);
      const selectedNorm = new Set(selected.map(normalizeEndpoint));
      const known = new Set(cdns.map(endpointValue).filter(Boolean));
      const extras = selected.filter((item) => !known.has(normalizeEndpoint(item)));
      const opts = cdns.map((entry) => {
        const val = endpointValue(entry);
        const checked = selectedNorm.has(val) ? 'checked' : '';
        return `<label class="cdn-opt">
          <input type="checkbox" data-cdn-val="${esc(val)}" ${checked}>
          <span class="cdn-text"><strong>${esc(entry.name || 'Endpoint')}</strong><code>${esc(entry.value || '')}</code></span>
        </label>`;
      }).join('');
      return `<div class="fld wide" id="${id}" data-k="${f.k}" data-cdn="1">
        <div class="fld-head">
          <span>${esc(f.l)}</span>
          <div class="mini-actions">
            <button class="mini-btn" type="button" data-cdn-all>Selecionar todos</button>
            <button class="mini-btn" type="button" data-cdn-none>Limpar</button>
          </div>
        </div>
        <div class="cdn-box">
          ${opts ? `<div class="cdn-options">${opts}</div>` : '<p class="muted">Nenhum endpoint cadastrado. Cadastre na aba Endpoints ou digite abaixo.</p>'}
          <label class="cdn-extra">
            <span>Outros endpoints (um por linha, host:porta)</span>
            <textarea data-cdn-extra rows="2" placeholder="exemplo.com:443">${esc(extras.join('\n'))}</textarea>
          </label>
        </div>
      </div>`;
    }

    return `<label class="fld"><span>${esc(f.l)}</span><input type="${ft === 'number' ? 'number' : 'text'}" id="${id}" data-k="${f.k}" value="${esc(v ?? '')}" placeholder="${esc(f.h || '')}"></label>`;
  }

  function openEditor(idx) {
    editIdx = idx;
    editorIsNew = idx < 0;
    if (idx < 0) {
      const mode = schema ? schema.defaultMode : 'SSH_PROXY';
      editorDraft = { mode, type: mode };
      const cat = categories[0];
      if (cat) {
        editorDraft.category = { id: cat.id, name: cat.name, color: cat.color, sorter: cat.sorter };
        editorDraft.category_id = cat.id;
      }
    } else {
      editorDraft = deepClone(rows[idx]);
    }
    renderEditor();
  }

  function renderEditor() {
    const c = editorDraft;
    const mode = c.mode || c.type || (schema ? schema.defaultMode : 'SSH_PROXY');
    const def = (schema && schema.modes && schema.modes[mode]) || null;
    const groups = def ? def.groups : [['Campos', []]];

    const seen = new Set();
    const body = groups
      .map(([label, fields]) => {
        const visible = fields.filter((f) => {
          if (seen.has(f.k)) return false;
          seen.add(f.k);
          return true;
        });
        if (!visible.length) return '';
        return `<fieldset>
          <legend>${esc(label)}</legend>
          <div class="form-grid">${visible.map((f) => fieldHtml(c, f)).join('')}</div>
        </fieldset>`;
      })
      .join('');

    const modeEntries = Object.entries((schema && schema.modes) || {});
    if (!modeEntries.some(([k]) => k === mode)) modeEntries.unshift([mode, { label: mode }]);
    const modes = modeEntries
      .map(([k, m]) => `<option value="${esc(k)}" ${k === mode ? 'selected' : ''}>${esc(m.label || k)}</option>`)
      .join('');

    $('#modal').innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <div class="modal-title">
          <h2>${editorIsNew ? 'Nova conexão' : 'Editar conexão'}</h2>
          <small>${esc(def ? def.hint : 'modo de conexão')}</small>
        </div>
        <select id="fMode" aria-label="Modo de conexão">${modes}</select>
        <button class="icon-btn" id="mClose" type="button" aria-label="Fechar">✕</button>
      </div>
      ${def ? `<div class="modal-hint">${esc(def.hint)}</div>` : ''}
      <div class="modal-body">${body || '<p class="muted">Nenhum campo disponível para este modo.</p>'}</div>
      <div class="modal-foot">
        <button class="btn ghost" id="mCancel" type="button">Cancelar</button>
        <button class="btn primary" id="mSave" type="button">Salvar no servidor</button>
      </div>
    </div>`;
    $('#modal').classList.remove('hidden');

    $('#mClose').addEventListener('click', closeEditor);
    $('#mCancel').addEventListener('click', closeEditor);
    $('#mSave').addEventListener('click', saveEditor);
    $('#fMode').addEventListener('change', (ev) => {
      const next = ev.target.value;
      collectForm(editorDraft, true);
      editorDraft.mode = next;
      editorDraft.type = next;
      renderEditor();
    });

    $$('#modal select[data-cat]').forEach((sel) => {
      const input = sel.parentElement.querySelector('input[type=text]');
      const toggle = () => {
        if (input) input.classList.toggle('hidden', sel.value !== '__new__');
      };
      sel.addEventListener('change', toggle);
      toggle();
    });

    $$('#modal [data-reveal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });

    $$('#modal [data-cdn-all]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const box = btn.closest('[data-cdn]');
        if (box) $$('input[type=checkbox][data-cdn-val]', box).forEach((cb) => { cb.checked = true; });
      });
    });
    $$('#modal [data-cdn-none]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const box = btn.closest('[data-cdn]');
        if (box) $$('input[type=checkbox][data-cdn-val]', box).forEach((cb) => { cb.checked = false; });
      });
    });
  }

  function closeEditor() {
    $('#modal').classList.add('hidden');
    $('#modal').innerHTML = '';
    editIdx = null;
    editorDraft = null;
    editorIsNew = false;
  }

  function collectForm(target, silent = false) {
    let categoria = null;
    let invalid = false;

    $$('#modal [data-k]').forEach((el) => {
      const k = el.dataset.k;
      const f = SCHEMA_FIELDS.get(k) || { k };

      if (el.dataset.cat) {
        const input = el.parentElement.querySelector('input[type=text]');
        const nova = input && !input.classList.contains('hidden') ? input.value.trim() : '';
        if (el.value === '__new__') {
          if (!nova) {
            if (!silent) toast('Digite o nome da nova categoria', 'err');
            invalid = true;
            return;
          }
          categoria = { id: '__new__', name: nova };
        } else if (el.value === '') {
          categoria = { id: '', name: '' };
        } else {
          const cat = categories.find((x) => String(x.id) === String(el.value) || x.name === el.value);
          categoria = { id: el.value, name: cat ? cat.name : el.value, color: cat && cat.color, sorter: cat && cat.sorter };
        }
        return;
      }

      let val;
      if (el.dataset.cdn) {
        const vals = [];
        $$('input[type=checkbox][data-cdn-val]', el).forEach((cb) => {
          if (cb.checked) vals.push(cb.dataset.cdnVal);
        });
        const extra = $('[data-cdn-extra]', el);
        if (extra) {
          extra.value.split('\n').map((s) => s.trim()).filter(Boolean)
            .forEach((s) => vals.push(normalizeEndpoint(s)));
        }
        val = [...new Set(vals)];
      } else if (el.dataset.json) {
        const raw = el.value.trim();
        if (!raw) {
          val = null;
        } else {
          try { val = JSON.parse(raw); } catch (_) {
            if (!silent) toast(`JSON inválido em ${f.l || k}`, 'err');
            invalid = true;
            return;
          }
        }
      } else if (el.type === 'checkbox') {
        val = el.checked;
      } else if (el.dataset.dns) {
        val = el.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      } else if (el.type === 'number') {
        val = el.value === '' ? 0 : Number(el.value);
      } else {
        val = el.value;
      }

      const paths = f.paths || (f.path ? [f.path] : []);
      if (paths.length) {
        let destino = paths[0];
        for (const p of paths) {
          if (getPath(target, p) !== undefined) { destino = p; break; }
        }
        for (const alt of (f.keys || [f.k])) {
          if (alt !== k && !destino.startsWith(alt + '.')) delete target[alt];
        }
        if (destino !== k && !paths.some((p) => p.startsWith(k + '.'))) delete target[k];
        setPath(target, destino, val);
      } else {
        for (const alt of (f.keys || [f.k])) {
          if (alt !== k) delete target[alt];
        }
        target[k] = val;
      }
    });

    if (invalid) return false;

    if (categoria) {
      if (!categoria.id) {
        delete target.category;
        target.category_id = 0;
      } else {
        const cat = target.category && typeof target.category === 'object' ? Object.assign({}, target.category) : {};
        if (categoria.id === '__new__') {
          cat.id = nextCategoryId();
          cat.name = categoria.name;
          cat.color = cat.color || '#5b8cff';
          cat.sorter = Number(cat.sorter) || (rows.length + 1);
        } else {
          const id = Number(categoria.id);
          cat.id = Number.isFinite(id) ? id : categoria.id;
          cat.name = categoria.name;
          cat.color = categoria.color || cat.color || '#5b8cff';
          cat.sorter = Number(categoria.sorter ?? cat.sorter) || 1;
        }
        target.category = cat;
        target.category_id = cat.id;
        delete target.category_name;
      }
    }

    return true;
  }

  async function saveEditor() {
    if (!collectForm(editorDraft)) return;
    if (editorIsNew) {
      editorDraft.id = nextConnectionId();
      rows.push(editorDraft);
      editIdx = rows.length - 1;
      editorIsNew = false;
    } else {
      rows[editIdx] = editorDraft;
    }
    dirty = true;
    render();
    const ok = await save();
    if (ok) closeEditor();
  }

  async function exportJson() {
    if (current !== 'configs') { toast('A exportação é só da aba Conexões', 'err'); return; }
    try {
      const formato = confirm('OK = formato da API oficial do DTunnel (aninhado)\nCancelar = formato plano que o app usa') ? 'api' : 'app';
      const res = await fetch('/api/configs/export?formato=' + formato);
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dtunnel-conexoes-${formato}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`Exportado: ${data.length} conexões (${formato})`, 'ok');
    } catch (e) {
      toast('Erro ao exportar: ' + e.message, 'err');
    }
  }

  async function importJson(file) {
    try {
      const texto = await file.text();
      let payload = JSON.parse(texto);
      if (!Array.isArray(payload)) payload = payload.data || payload.configs || [];
      const r = await api('/api/configs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      toast(`Importado: ${r.count} conexões (formato ${r.formato}).`, 'ok');
      await load();
    } catch (e) {
      toast('Erro ao importar: ' + e.message, 'err');
    }
  }

  async function restore() {
    if (current === 'logs') return;
    if (!confirm('Restaurar o backup (.bak) do arquivo atual?')) return;
    try {
      const r = await api(`/api/${current}/restore`, { method: 'POST' });
      toast(`Restaurado: ${r.count} itens`, 'ok');
      load();
    } catch (e) {
      toast('Erro: ' + e.message, 'err');
    }
  }

  async function openPasswordModal() {
    $('#passError').classList.add('hidden');
    $('#passError').textContent = '';
    $('#passCurrent').value = '';
    $('#passNew').value = '';
    $('#passConfirm').value = '';
    $('#passModal').classList.remove('hidden');
    setTimeout(() => $('#passCurrent').focus(), 40);
    try {
      const s = await api('/api/auth/state');
      $('#passHint').textContent = s.custom
        ? 'Senha personalizada ativa. Informe a senha atual para trocá-la.'
        : 'O painel está usando a senha padrão do servidor. Defina uma senha própria.';
    } catch (_) {
      $('#passHint').textContent = 'Informe a senha atual para definir uma nova senha.';
    }
  }

  function closePasswordModal() {
    $('#passModal').classList.add('hidden');
  }

  async function savePassword() {
    const err = $('#passError');
    const atual = $('#passCurrent').value;
    const nova = $('#passNew').value;
    const conf = $('#passConfirm').value;
    const fail = (msg) => {
      err.textContent = msg;
      err.classList.remove('hidden');
    };
    if (!atual) return fail('Informe a senha atual.');
    if (nova.length < 4) return fail('A nova senha precisa ter pelo menos 4 caracteres.');
    if (nova !== conf) return fail('A confirmação não confere com a nova senha.');
    try {
      await api('/api/auth/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: atual, newPassword: nova }),
      });
      toast('Senha alterada com sucesso.', 'ok');
      closePasswordModal();
    } catch (e) {
      fail(e.message);
    }
  }

  function selectTab(file) {
    current = file;
    $$('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.file === file));
    $('#pageTitle').textContent = TITLES[file] || file;
    $('#pageSub').textContent = SUBTITLES[file] || '';
    $('#search').value = '';
    $('#search').disabled = file === 'logs';
    const isConfigs = file === 'configs';
    const isLogs = file === 'logs';
    $('#export').classList.toggle('hidden', !isConfigs);
    $('#import').classList.toggle('hidden', !isConfigs);
    $('#add').classList.toggle('hidden', isLogs);
    $('#save').classList.toggle('hidden', isLogs);
    $('#restore').classList.toggle('hidden', isLogs);
    load();
  }

  async function loadSchema() {
    try {
      schema = await api('/api/config-schema');
      SCHEMA_FIELDS.clear();
      for (const m of Object.values(schema.modes || {})) {
        for (const [, fields] of m.groups) {
          for (const f of fields) SCHEMA_FIELDS.set(f.k, f);
        }
      }
    } catch (_) {
      schema = null;
    }
  }

  async function loadMeta() {
    const res = await Promise.allSettled([api('/api/categories'), api('/api/cdns')]);
    if (res[0].status === 'fulfilled') categories = res[0].value.data || [];
    if (res[1].status === 'fulfilled') cdns = res[1].value.data || [];
  }

  function bind() {
    $$('#tabs .tab').forEach((t) =>
      t.addEventListener('click', () => selectTab(t.dataset.file))
    );

    $('#save').addEventListener('click', save);
    $('#export').addEventListener('click', exportJson);
    $('#import').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) importJson(f);
      ev.target.value = '';
    });
    $('#add').addEventListener('click', add);
    $('#reload').addEventListener('click', () => load());
    $('#restore').addEventListener('click', restore);
    $('#search').addEventListener('input', render);
    $('#changePass').addEventListener('click', openPasswordModal);
    $('#passClose').addEventListener('click', closePasswordModal);
    $('#passCancel').addEventListener('click', closePasswordModal);
    $('#passSave').addEventListener('click', savePassword);

    $('#modal').addEventListener('click', (ev) => {
      if (ev.target === $('#modal')) closeEditor();
    });
    $('#passModal').addEventListener('click', (ev) => {
      if (ev.target === $('#passModal')) closePasswordModal();
    });

    $('#editor').addEventListener('click', (ev) => {
      const edit = ev.target.closest('[data-edit]');
      if (edit) { openEditor(Number(edit.dataset.edit)); return; }
      const del = ev.target.closest('[data-del]');
      if (del) { deleteRow(Number(del.dataset.del)); return; }
      if (ev.target.closest('[data-new]')) { add(); return; }
      const head = ev.target.closest('.gen-head');
      if (head && !ev.target.closest('button')) {
        head.parentElement.classList.toggle('open');
      }
    });

    const onCell = (ev) => {
      const el = ev.target.closest('[data-key]');
      if (!el || !el.closest('.gen-body')) return;
      const card = el.closest('.card');
      const idx = Number(card && card.dataset.idx);
      if (!Number.isInteger(idx) || !rows[idx]) return;
      const key = el.dataset.key;
      let val;
      switch (el.dataset.kind) {
        case 'bool': val = el.checked; break;
        case 'number': val = el.value === '' ? 0 : Number(el.value); break;
        case 'json':
          try { val = JSON.parse(el.value); } catch (_) { return; }
          break;
        default: val = el.value;
      }
      rows[idx][key] = val;
      dirty = true;
      updateCount();
    };
    $('#editor').addEventListener('input', onCell);
    $('#editor').addEventListener('change', onCell);

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
      if (e.key === 'Escape') {
        if (!$('#passModal').classList.contains('hidden')) closePasswordModal();
        else if (!$('#modal').classList.contains('hidden')) closeEditor();
      }
      if (e.key === '/' && !typing && current !== 'logs') {
        e.preventDefault();
        $('#search').focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
  }

  async function boot() {
    bind();
    await Promise.all([loadSchema(), loadMeta()]);
    selectTab('configs');
    loadStatus();
    setInterval(loadStatus, 15000);
  }

  boot();
})();
