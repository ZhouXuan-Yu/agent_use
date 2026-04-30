/**
 * conversation.js — Conversation persistence: save, restore, drawer, history.
 */
'use strict';

window.App = window.App || {};

function updateConvTitleUI() {
  document.getElementById('conv-title-display').textContent = App.state.currentConvTitle;
}

function ensureConvId() {
  if (!App.state.currentConvId) {
    App.state.currentConvId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  return App.state.currentConvId;
}

function autoTitle() {
  if (App.state.currentConvTitle !== '新对话') return;
  const first = App.state.chatHistory.find(m => m.role === 'user');
  if (first) {
    App.state.currentConvTitle = first.content.slice(0, 40) + (first.content.length > 40 ? '…' : '');
    updateConvTitleUI();
  }
}

function serializeFullState() {
  const s = App.state;
  return {
    id: ensureConvId(),
    title: s.currentConvTitle,
    chatHistory: s.chatHistory,
    chatMessagesHtml: document.getElementById('chat-messages').innerHTML,
    chatScrollTop: document.getElementById('chat-messages').scrollTop,
    lastRunData: s.lastRunData,
    toolCallDataByName: s.toolCallDataByName,
    lastCalledTool: s.lastCalledTool,
    pipelineStep: App.getCurrentPipelineStep(),
    currentDetailStep: s.currentDetailStep,
    pipeDetailOpen: document.getElementById('pipe-detail').classList.contains('show'),
    currentDetailTool: s.currentDetailTool,
    toolDetailOpen: document.getElementById('tool-detail').classList.contains('show'),
    highlightedTools: Array.from(document.querySelectorAll('.tool-card.tool-just-called')).map(c => c.dataset.tool),
    selectedImages: s.selectedImages,
    chatInputValue: document.getElementById('chat-input').value,
    activeTab: document.querySelector('.tab-btn.active')?.dataset.tab || 'main',
  };
}

App.restoreFullState = function(state) {
  const s = App.state;
  const chatMessages = document.getElementById('chat-messages');
  s.chatHistory = state.chatHistory || [];
  chatMessages.innerHTML = state.chatMessagesHtml || '';
  reattachChatDomListeners();
  if (state.chatScrollTop != null) {
    requestAnimationFrame(() => { chatMessages.scrollTop = state.chatScrollTop; });
  }
  s.lastRunData = state.lastRunData || { userMessage: null, llmRequest: null, llmResponse: null, toolName: null, toolArgs: null, toolResult: null, answer: null, totalMs: 0, steps: [] };
  s.toolCallDataByName = state.toolCallDataByName || {};
  s.lastCalledTool = state.lastCalledTool || null;

  App.buildDynamicPipeline(s.lastRunData.steps, true);

  s.currentDetailStep = state.currentDetailStep != null ? state.currentDetailStep : -1;
  const pipeDetailEl = document.getElementById('pipe-detail');
  if (state.pipeDetailOpen && s.currentDetailStep >= 0 && s.lastRunData.steps && s.currentDetailStep < s.lastRunData.steps.length) {
    App.renderDynamicPipeDetail(s.currentDetailStep);
  } else {
    pipeDetailEl.classList.remove('show');
  }

  s.currentDetailTool = state.currentDetailTool || null;
  const toolDetailEl = document.getElementById('tool-detail');
  if (state.toolDetailOpen && s.currentDetailTool) {
    App.renderToolDetail(s.currentDetailTool);
  } else {
    toolDetailEl.classList.remove('show');
    s.currentDetailTool = null;
  }

  App.clearToolHighlights();
  if (state.highlightedTools) {
    state.highlightedTools.forEach(name => {
      const card = document.querySelector(`.tool-card[data-tool="${name}"]`);
      if (card) card.classList.add('tool-just-called');
    });
  }

  s.selectedImages = state.selectedImages || [];
  document.querySelectorAll('.lib-card').forEach(c => {
    if (s.selectedImages.includes(c.dataset.name)) c.classList.add('selected');
    else c.classList.remove('selected');
  });

  document.getElementById('chat-input').value = state.chatInputValue || '';

  if (state.activeTab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${state.activeTab}"]`);
    if (btn) btn.classList.add('active');
    const tab = document.getElementById('tab-' + state.activeTab);
    if (tab) tab.classList.add('active');
    if (state.activeTab === 'settings') App.initAISettings();
  }

  s.currentConvId = state.id || null;
  s.currentConvTitle = state.title || '新对话';
  updateConvTitleUI();
};

function reattachChatDomListeners() {
  const chatMessages = document.getElementById('chat-messages');
  chatMessages.querySelectorAll('.trace-header').forEach(hdr => {
    hdr.addEventListener('click', function(e) {
      if (e.target.closest('.trace-save-skill-btn')) return;
      this.classList.toggle('open');
      this.closest('.trace-block')?.classList.toggle('open');
    });
  });
  chatMessages.querySelectorAll('.wf-step-head').forEach(hdr => {
    hdr.addEventListener('click', function() {
      this.closest('.wf-step')?.classList.toggle('open');
    });
  });
  chatMessages.querySelectorAll('.json-panel-head').forEach(hdr => {
    hdr.addEventListener('click', function(e) {
      e.stopPropagation();
      this.closest('.json-panel')?.classList.toggle('open');
    });
  });
  chatMessages.querySelectorAll('.msg-vis img').forEach(img => {
    if (!img.onclick) {
      img.addEventListener('click', function() { showLightbox(this.src); });
    }
  });
  if (App.injectSaveSkillBtnsFromDom) App.injectSaveSkillBtnsFromDom();
}

/* ── Save helpers ── */

function flashAutosaveDot() {
  const dot = document.getElementById('conv-autosave-dot');
  dot.classList.add('flash');
  setTimeout(() => dot.classList.remove('flash'), 1200);
}

function scheduleSave() {
  if (App.state.savePending) return;
  App.state.savePending = setTimeout(() => { App.state.savePending = null; App.doSave(); }, 800);
}

App.beaconSave = function() {
  if (App.state.chatHistory.length === 0) return;
  autoTitle();
  const state = serializeFullState();
  try {
    const ok = navigator.sendBeacon('/api/conversations', new Blob(
      [JSON.stringify(state)], { type: 'application/json' }
    ));
    if (ok) flashAutosaveDot();
  } catch (e) { console.error('beaconSave error:', e); }
};

App.doSave = async function() {
  if (App.state.chatHistory.length === 0) return;
  autoTitle();
  const state = serializeFullState();
  try {
    const resp = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!resp.ok) { console.error('Save failed:', resp.status); return; }
    const data = await resp.json();
    if (data.ok) flashAutosaveDot();
  } catch (e) { console.error('Save error:', e); }
};

async function doSaveNow() {
  if (App.state.savePending) { clearTimeout(App.state.savePending); App.state.savePending = null; }
  await App.doSave();
}

App.markDirty = function() { scheduleSave(); };

/* ── Load / New / Delete ── */

async function loadConversation(convId) {
  try {
    const resp = await fetch(`/api/conversations/${convId}`);
    if (!resp.ok) return;
    const state = await resp.json();
    App.restoreFullState(state);
    closeConvDrawer();
  } catch {}
}

async function deleteConversation(convId) {
  try {
    await fetch(`/api/conversations/${convId}`, { method: 'DELETE' });
    if (App.state.currentConvId === convId) App.startNewConversation();
    refreshConvDrawer();
  } catch {}
}

App.startNewConversation = function() {
  const s = App.state;
  s.currentConvId = null;
  s.currentConvTitle = '新对话';
  s.chatHistory = [];
  document.getElementById('chat-messages').innerHTML = `
    <div class="msg msg-assistant">
      <div class="bubble">你好！我是视觉分析 Agent 🔍<br>
      我可以调用 <strong>ORB 特征匹配</strong> 工具来帮你分析图像。试试问我：<br>
      • "这两张图是同一个地方吗？"<br>
      • "帮我检测某张图的关键点"<br>
      • "在所有图片里找到和某张图最相似的"<br><br>
      <span style="color:#8b949e;font-size:0.78rem">💡 点击左侧图像可以快速选中，图片名会自动填入。</span>
      </div>
    </div>`;
  document.getElementById('chat-input').value = '';
  App.resetLastRunData();
  App.resetToolCallData();
  App.clearToolHighlights();
  s.selectedImages = [];
  document.querySelectorAll('.lib-card.selected').forEach(c => c.classList.remove('selected'));
  App.setPipelineStep(-1);
  s.currentDetailStep = -1;
  document.getElementById('pipe-detail').classList.remove('show');
  s.currentDetailTool = null;
  document.getElementById('tool-detail').classList.remove('show');
  updateConvTitleUI();
};

/* ── Drawer ── */

function openConvDrawer() {
  document.getElementById('conv-drawer-overlay').classList.add('show');
  refreshConvDrawer();
}

function closeConvDrawer() {
  document.getElementById('conv-drawer-overlay').classList.remove('show');
}

async function refreshConvDrawer() {
  const convDrawerList = document.getElementById('conv-drawer-list');
  try {
    const resp = await fetch('/api/conversations');
    const data = await resp.json();
    const convos = data.conversations || [];
    if (convos.length === 0) {
      convDrawerList.innerHTML = '<div class="conv-drawer-empty">暂无保存的对话</div>';
      return;
    }
    convDrawerList.innerHTML = convos.map(c => `
      <div class="conv-item ${c.id === App.state.currentConvId ? 'active' : ''}" data-id="${App.escapeHtml(c.id)}">
        <div class="conv-item-title">${App.escapeHtml(c.title || '未命名对话')}</div>
        <div class="conv-item-meta">
          <span>${c.message_count || 0} 条消息</span>
          <span>${App.escapeHtml(c.updated_at || c.created_at || '')}</span>
        </div>
        <button class="conv-item-del" data-id="${App.escapeHtml(c.id)}" title="删除">🗑️</button>
      </div>
    `).join('');

    convDrawerList.querySelectorAll('.conv-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.conv-item-del')) return;
        await doSaveNow();
        await loadConversation(item.dataset.id);
      });
    });
    convDrawerList.querySelectorAll('.conv-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('确定删除此对话？')) deleteConversation(btn.dataset.id);
      });
    });
  } catch (e) {
    convDrawerList.innerHTML = `<div class="conv-drawer-empty" style="color:#f85149;">加载失败</div>`;
  }
}

App.restoreLastSession = async function() {
  try {
    const resp = await fetch('/api/conversations');
    const data = await resp.json();
    const convos = data.conversations || [];
    if (convos.length > 0) {
      const full = await fetch(`/api/conversations/${convos[0].id}`);
      if (full.ok) {
        App.restoreFullState(await full.json());
        return;
      }
    }
  } catch {}
};

App.initConversationUI = function() {
  const convTitleDisplay = document.getElementById('conv-title-display');
  const convTitleInput = document.getElementById('conv-title-input');
  const convDrawerOverlay = document.getElementById('conv-drawer-overlay');

  convTitleDisplay.addEventListener('dblclick', () => {
    convTitleInput.value = App.state.currentConvTitle;
    convTitleDisplay.style.display = 'none';
    convTitleInput.style.display = '';
    convTitleInput.focus();
    convTitleInput.select();
  });

  function commitTitleEdit() {
    const v = convTitleInput.value.trim();
    convTitleInput.style.display = 'none';
    convTitleDisplay.style.display = '';
    if (v && v !== App.state.currentConvTitle) {
      App.state.currentConvTitle = v;
      updateConvTitleUI();
      if (App.state.currentConvId) {
        fetch(`/api/conversations/${App.state.currentConvId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: v }),
        }).catch(() => {});
      }
      scheduleSave();
    }
  }

  convTitleInput.addEventListener('blur', commitTitleEdit);
  convTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); convTitleInput.blur(); }
    if (e.key === 'Escape') { convTitleInput.value = App.state.currentConvTitle; convTitleInput.blur(); }
  });

  document.getElementById('btn-new-conv').addEventListener('click', async () => {
    await doSaveNow();
    App.startNewConversation();
  });

  document.getElementById('btn-history-conv').addEventListener('click', openConvDrawer);
  document.getElementById('conv-drawer-close').addEventListener('click', closeConvDrawer);
  convDrawerOverlay.addEventListener('click', (e) => {
    if (e.target === convDrawerOverlay) closeConvDrawer();
  });

  window.addEventListener('beforeunload', () => { App.beaconSave(); });
};
