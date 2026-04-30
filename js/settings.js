/**
 * settings.js — AI provider settings, Ollama model management, tab navigation.
 */
'use strict';

window.App = window.App || {};

const PROVIDER_META = {
  ollama:   { icon: '🖥️', color: '#3fb950', label: 'Ollama',         badge: 'local',  badgeClass: 'badge-local' },
  deepseek: { icon: '🔮', color: '#58a6ff', label: 'DeepSeek',       badge: 'cloud',  badgeClass: 'badge-cloud' },
  kimi:     { icon: '🌙', color: '#d2a8ff', label: 'Kimi (Moonshot)', badge: 'cloud',  badgeClass: 'badge-cloud' },
  minimax:  { icon: '⚡', color: '#ffa657', label: 'MiniMax',         badge: 'cloud',  badgeClass: 'badge-cloud' },
  glm:      { icon: '🧠', color: '#79c0ff', label: 'GLM (智谱)',      badge: 'cloud',  badgeClass: 'badge-cloud' },
};

App.loadAIConfig = async function() {
  try {
    const resp = await fetch('/api/ai-config');
    App.state.aiConfig = await resp.json();
  } catch {
    App.state.aiConfig = { active_provider: 'ollama', providers: {} };
  }
  App.updateAIBadge();
};

App.updateAIBadge = function() {
  const cfg = App.state.aiConfig;
  if (!cfg) return;
  const pid = cfg.active_provider || 'ollama';
  const meta = PROVIDER_META[pid] || {};
  const provCfg = (cfg.providers || {})[pid] || {};
  const el = document.getElementById('current-ai-label');
  if (el) el.textContent = `${meta.label || pid} / ${provCfg.model || '—'}`;
};

App.saveAIConfig = async function() {
  if (!App.state.aiConfig) return;
  try {
    await fetch('/api/ai-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(App.state.aiConfig),
    });
  } catch (e) { console.error('Save AI config failed', e); }
  App.updateAIBadge();
};

App.initAISettings = function() {
  if (App.state.aiSettingsLoaded && App.state.aiConfig) {
    renderProviderTabs();
    return;
  }
  App.state.aiSettingsLoaded = true;
  App.loadAIConfig().then(() => {
    renderProviderTabs();
    renderProviderConfig(App.state.aiConfig.active_provider);
  });
};

function renderProviderTabs() {
  const container = document.getElementById('provider-tabs');
  container.innerHTML = '';
  const cfg = App.state.aiConfig;
  for (const pid of ['ollama', 'deepseek', 'kimi', 'minimax', 'glm']) {
    const meta = PROVIDER_META[pid];
    const isActive = cfg.active_provider === pid;
    const status = App.state.providerTestStatus[pid];
    let statusHtml = '<span class="provider-status">未测试</span>';
    if (status === 'ok') statusHtml = '<span class="provider-status ok">✓ 已连接</span>';
    else if (status === 'err') statusHtml = '<span class="provider-status err">✗ 连接失败</span>';
    else if (status === 'testing') statusHtml = '<span class="provider-status" style="color:#d29922;">测试中…</span>';

    const tab = document.createElement('div');
    tab.className = 'provider-tab' + (isActive ? ' active' : '');
    tab.innerHTML = `
      <div class="provider-radio"></div>
      <div class="provider-info">
        <span class="provider-name">${meta.icon} ${meta.label}</span>
        ${statusHtml}
      </div>`;
    tab.addEventListener('click', () => {
      cfg.active_provider = pid;
      App.saveAIConfig();
      renderProviderTabs();
      renderProviderConfig(pid);
    });
    container.appendChild(tab);
  }
}

function renderProviderConfig(pid) {
  const area = document.getElementById('provider-config-area');
  const meta = PROVIDER_META[pid];
  const cfg = (App.state.aiConfig.providers || {})[pid] || {};
  const ollamaSection = document.getElementById('ollama-models-section');

  if (pid === 'ollama') {
    const currentModel = (cfg.model || '').trim();
    area.innerHTML = `
      <div class="config-section">
        <h3>${meta.icon} ${meta.label} <span class="badge badge-local">本地</span>
          <span style="margin-left:auto;font-size:0.72rem;font-weight:400;color:#3fb950;" id="ollama-conn-status">检测中…</span>
        </h3>
        <div style="font-size:0.78rem;color:#8b949e;margin-bottom:10px;">
          Ollama 运行在本机，无需 API Key。直接在下方选择一个已安装的模型即可。
          <span id="ollama-current-model">${currentModel ? `<br>当前模型：<strong style="color:#e6edf3;">${App.escapeHtml(currentModel)}</strong>` : '<br><span style="color:#d29922;">⚠ 尚未选择模型，请在下方点击选择</span>'}</span>
        </div>
        <details style="margin-bottom:8px;">
          <summary style="font-size:0.72rem;color:#484f58;cursor:pointer;">高级设置 · 自定义 Ollama 地址</summary>
          <div style="margin-top:6px;">
            <div class="config-field" style="max-width:400px;">
              <label>API 地址 Base URL</label>
              <input type="text" id="cfg-base-url" value="${App.escapeHtml(cfg.base_url || 'http://localhost:11434')}" placeholder="http://localhost:11434">
              <div class="field-hint">仅在 Ollama 运行在远程服务器时需要修改</div>
            </div>
            <button class="btn-test" style="margin-top:6px;" onclick="App.saveOllamaUrl()">保存地址并重新检测</button>
          </div>
        </details>
        <div class="test-result" id="test-result"></div>
      </div>`;
    ollamaSection.style.display = '';
    loadOllamaModels();
    startOllamaAutoRefresh();
    checkOllamaConnection();
    return;
  }

  ollamaSection.style.display = 'none';
  stopOllamaAutoRefresh();

  const defaultModels = {
    deepseek: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    minimax: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab5.5-chat'],
    glm: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4'],
  };
  const models = defaultModels[pid] || [];
  const opts = models.map(m => `<option value="${m}" ${m===cfg.model?'selected':''}>${m}</option>`).join('');

  area.innerHTML = `
    <div class="config-section">
      <h3>${meta.icon} ${meta.label} 配置 <span class="badge ${meta.badgeClass}">云端</span></h3>
      <div class="config-row">
        <div class="config-field">
          <label>API 地址 Base URL</label>
          <input type="text" id="cfg-base-url" value="${App.escapeHtml(cfg.base_url || '')}" placeholder="https://api.example.com">
          <div class="field-hint">一般无需修改</div>
        </div>
        <div class="config-field">
          <label>API Key</label>
          <div class="input-wrap">
            <input type="password" id="cfg-api-key" value="${App.escapeHtml(cfg.api_key || '')}" placeholder="sk-…" autocomplete="off">
            <button class="key-toggle" type="button" onclick="App.toggleKeyVisibility(this)" title="显示/隐藏">👁</button>
          </div>
          <div class="field-hint">Key 保存在服务器本地，不会外泄</div>
        </div>
      </div>
      <div class="config-row">
        <div class="config-field">
          <label>模型 Model</label>
          <select id="cfg-model">${opts}<option value="">自定义…</option></select>
          <input type="text" id="cfg-model-custom" placeholder="或输入自定义模型名" style="margin-top:4px;display:none" value="">
        </div>
      </div>
      <div class="config-actions">
        <button class="btn-test" id="btn-test-conn" onclick="App.testConnection('${pid}')">🔗 测试连接</button>
        <button class="btn-save" onclick="App.saveProviderConfig('${pid}')">💾 保存配置</button>
      </div>
      <div class="test-result" id="test-result"></div>
    </div>`;

  const modelSelect = document.getElementById('cfg-model');
  const modelCustom = document.getElementById('cfg-model-custom');
  if (modelSelect && modelCustom) {
    modelSelect.addEventListener('change', () => {
      modelCustom.style.display = modelSelect.value === '' ? 'block' : 'none';
    });
  }
}

async function checkOllamaConnection() {
  const statusEl = document.getElementById('ollama-conn-status');
  if (!statusEl) return;
  try {
    const resp = await fetch('/api/ollama-models');
    const data = await resp.json();
    if (data.error) {
      statusEl.textContent = '✗ 未连接';
      statusEl.style.color = '#f85149';
      App.state.providerTestStatus.ollama = 'err';
    } else {
      statusEl.textContent = `✓ 已连接 · ${(data.models||[]).length} 个模型`;
      statusEl.style.color = '#3fb950';
      App.state.providerTestStatus.ollama = 'ok';
    }
  } catch {
    statusEl.textContent = '✗ 无法连接';
    statusEl.style.color = '#f85149';
    App.state.providerTestStatus.ollama = 'err';
  }
  renderProviderTabs();
}

App.saveOllamaUrl = async function() {
  const baseUrl = document.getElementById('cfg-base-url')?.value.trim();
  if (!baseUrl) return;
  if (!App.state.aiConfig.providers) App.state.aiConfig.providers = {};
  if (!App.state.aiConfig.providers.ollama) App.state.aiConfig.providers.ollama = {};
  App.state.aiConfig.providers.ollama.base_url = baseUrl;
  await App.saveAIConfig();
  loadOllamaModels();
  checkOllamaConnection();
  const resultEl = document.getElementById('test-result');
  if (resultEl) {
    resultEl.className = 'test-result show success';
    resultEl.textContent = '✓ 地址已保存，正在重新检测…';
    setTimeout(() => resultEl.classList.remove('show'), 2000);
  }
};

App.toggleKeyVisibility = function(btn) {
  const input = btn.previousElementSibling;
  if (input.type === 'password') { input.type = 'text'; btn.textContent = '🔒'; }
  else { input.type = 'password'; btn.textContent = '👁'; }
};

App.saveProviderConfig = async function(pid) {
  const baseUrl = document.getElementById('cfg-base-url')?.value.trim() || '';
  const apiKey = document.getElementById('cfg-api-key')?.value.trim() || '';
  let model = '';
  const modelEl = document.getElementById('cfg-model');
  if (modelEl) {
    if (modelEl.tagName === 'SELECT') model = modelEl.value || (document.getElementById('cfg-model-custom')?.value.trim() || '');
    else model = modelEl.value.trim();
  }

  const cfg = App.state.aiConfig;
  if (!cfg.providers) cfg.providers = {};
  if (!cfg.providers[pid]) cfg.providers[pid] = {};
  if (baseUrl) cfg.providers[pid].base_url = baseUrl;
  cfg.providers[pid].api_key = apiKey;
  if (model) cfg.providers[pid].model = model;
  cfg.active_provider = pid;

  await App.saveAIConfig();
  renderProviderTabs();

  const resultEl = document.getElementById('test-result');
  if (resultEl) {
    resultEl.className = 'test-result show success';
    resultEl.textContent = '✓ 配置已保存';
    setTimeout(() => resultEl.classList.remove('show'), 2000);
  }
};

App.testConnection = async function(pid) {
  const cfg = (App.state.aiConfig.providers || {})[pid] || {};
  const baseUrl = document.getElementById('cfg-base-url')?.value.trim() || cfg.base_url || '';
  const apiKey = document.getElementById('cfg-api-key')?.value.trim() || cfg.api_key || '';
  let model = '';
  const modelEl = document.getElementById('cfg-model');
  if (modelEl) {
    if (modelEl.tagName === 'SELECT') model = modelEl.value || (document.getElementById('cfg-model-custom')?.value.trim() || '');
    else model = modelEl.value.trim();
  }
  if (!model) model = cfg.model || '';

  const btn = document.getElementById('btn-test-conn');
  const resultEl = document.getElementById('test-result');
  btn.disabled = true;
  btn.textContent = '⏳ 测试中…';
  App.state.providerTestStatus[pid] = 'testing';
  renderProviderTabs();

  try {
    const resp = await fetch('/api/ai-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: pid, base_url: baseUrl, api_key: apiKey, model }),
    });
    const data = await resp.json();
    if (data.ok) {
      App.state.providerTestStatus[pid] = 'ok';
      resultEl.className = 'test-result show success';
      resultEl.innerHTML = `✓ 连接成功！模型 <strong>${App.escapeHtml(data.model||model)}</strong> 回复: "${App.escapeHtml(data.reply||'(empty)')}"`;
    } else {
      App.state.providerTestStatus[pid] = 'err';
      resultEl.className = 'test-result show error';
      let detail = data.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : '';
      resultEl.innerHTML = `✗ 连接失败: ${App.escapeHtml(data.error||'unknown')}${detail ? '<br><small>'+App.escapeHtml(detail.substring(0,200))+'</small>' : ''}`;
    }
  } catch (e) {
    App.state.providerTestStatus[pid] = 'err';
    resultEl.className = 'test-result show error';
    resultEl.textContent = '✗ 网络错误: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = '🔗 测试连接';
  renderProviderTabs();
};

/* ── Ollama Models ── */

async function loadOllamaModels() {
  const body = document.getElementById('ollama-models-body');
  try {
    const resp = await fetch('/api/ollama-models');
    const data = await resp.json();
    if (data.error) {
      body.innerHTML = `<div class="no-models" style="color:#f85149;">⚠️ ${App.escapeHtml(data.error)}</div>`;
      App.state.ollamaModels = [];
      return;
    }
    App.state.ollamaModels = data.models || [];
    renderOllamaModels();
  } catch (e) {
    body.innerHTML = `<div class="no-models" style="color:#f85149;">⚠️ 无法连接 Ollama: ${App.escapeHtml(e.message)}</div>`;
    App.state.ollamaModels = [];
  }
}

function guessToolSupport(model) {
  const name = (model.name || '').toLowerCase();
  const family = (model.family || '').toLowerCase();
  const noToolPatterns = ['deepseek-r1', 'r1', 'glm-ocr', 'phi', 'gemma', 'tinyllama', 'codellama'];
  const yesToolFamilies = ['qwen3', 'qwen35moe', 'qwen3moe', 'llama', 'mistral', 'command-r', 'gptoss'];
  if (noToolPatterns.some(p => name.includes(p))) return 'no';
  if (yesToolFamilies.some(f => family.includes(f))) return 'yes';
  return 'unknown';
}

function renderOllamaModels() {
  const body = document.getElementById('ollama-models-body');
  const models = App.state.ollamaModels;
  if (!models.length) {
    body.innerHTML = '<div class="no-models">没有找到已安装的模型。运行 <code>ollama pull &lt;model&gt;</code> 安装。</div>';
    return;
  }
  const currentModel = (App.state.aiConfig.providers?.ollama?.model || '').trim();
  let html = `<table class="model-table">
    <thead><tr><th>模型</th><th>大小</th><th>系列</th><th>工具调用</th><th>操作</th></tr></thead><tbody>`;
  for (const m of models) {
    const isCurrent = m.name === currentModel;
    const ts = guessToolSupport(m);
    const toolBadge = ts === 'yes' ? '<span class="model-badge" style="background:#0d2818;color:#3fb950;">✓ 支持</span>'
      : ts === 'no' ? '<span class="model-badge" style="background:#2d1117;color:#f85149;">✗ 不支持</span>'
      : '<span class="model-badge">未知</span>';
    html += `<tr class="${isCurrent ? 'selected' : ''}">
      <td><strong>${App.escapeHtml(m.name)}</strong></td>
      <td class="model-size">${App.formatBytes(m.size)}</td>
      <td><span class="model-badge">${App.escapeHtml(m.family || '—')}</span></td>
      <td>${toolBadge}</td>
      <td><button class="model-select-btn ${isCurrent ? 'active' : ''}" onclick="App.selectOllamaModel('${App.escapeHtml(m.name)}')">${isCurrent ? '✓ 当前' : '选择'}</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  html += '<p style="font-size:0.68rem;color:#484f58;margin-top:6px;">💡 不支持工具调用的模型仍可用于对话，但无法自动调用 ORB 视觉工具——会以纯文本方式回答。推荐使用支持工具调用的模型（如 qwen3.5、qwen3）获得最佳体验。</p>';
  body.innerHTML = html;
}

App.selectOllamaModel = function(name) {
  if (!App.state.aiConfig.providers) App.state.aiConfig.providers = {};
  if (!App.state.aiConfig.providers.ollama) App.state.aiConfig.providers.ollama = {};
  App.state.aiConfig.providers.ollama.model = name;
  App.saveAIConfig();
  renderOllamaModels();
  const el = document.getElementById('ollama-current-model');
  if (el) el.innerHTML = `<br>当前模型：<strong style="color:#e6edf3;">${App.escapeHtml(name)}</strong>`;
};

function startOllamaAutoRefresh() {
  stopOllamaAutoRefresh();
  const chk = document.getElementById('chk-auto-refresh');
  const dot = document.getElementById('auto-refresh-dot');
  if (!chk || !chk.checked) { if (dot) dot.classList.remove('active'); return; }
  if (dot) dot.classList.add('active');
  App.state.ollamaAutoRefreshTimer = setInterval(() => {
    if (document.getElementById('tab-settings')?.classList.contains('active') &&
        document.getElementById('ollama-models-section')?.style.display !== 'none') {
      loadOllamaModels();
    }
  }, 5000);
}

function stopOllamaAutoRefresh() {
  if (App.state.ollamaAutoRefreshTimer) {
    clearInterval(App.state.ollamaAutoRefreshTimer);
    App.state.ollamaAutoRefreshTimer = null;
  }
  const dot = document.getElementById('auto-refresh-dot');
  if (dot) dot.classList.remove('active');
}

App.initTabNavigation = function() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'settings') App.initAISettings();
      if (btn.dataset.tab === 'skills') {
        App.state.currentSkillDetail = null;
        App.loadSkills().then(() => App.renderSkillsTab());
      }
    });
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'chk-auto-refresh') {
      if (e.target.checked) startOllamaAutoRefresh();
      else stopOllamaAutoRefresh();
    }
  });

  document.getElementById('btn-refresh-models')?.addEventListener('click', function() {
    this.classList.add('spinning');
    loadOllamaModels().then(() => {
      setTimeout(() => this.classList.remove('spinning'), 300);
    });
  });
};
