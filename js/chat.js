/**
 * chat.js — Chat message rendering, trace waterfall, and the main sendMessage flow.
 */
'use strict';

window.App = window.App || {};

function scrollChat() {
  document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
}
App.scrollChat = scrollChat;

App.addSystemMsg = function(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-status';
  div.innerHTML = `<div class="bubble">${App.escapeHtml(text)}</div>`;
  document.getElementById('chat-messages').appendChild(div);
  scrollChat();
};

App.addUserMsg = function(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-user';
  div.innerHTML = `<div class="bubble">${App.escapeHtml(text)}</div>`;
  document.getElementById('chat-messages').appendChild(div);
  scrollChat();
};

App.addAssistantMsg = function(text) {
  const div = document.createElement('div');
  div.className = 'msg msg-assistant';
  div.innerHTML = `<div class="bubble">${App.formatMarkdown(text)}</div>`;
  document.getElementById('chat-messages').appendChild(div);
  scrollChat();
  return div;
};

App.addVisualization = function(name, b64) {
  const div = document.createElement('div');
  div.className = 'msg msg-vis';
  const friendlyLabel = {
    'vision_tool_detect_keypoints': 'ORB 关键点检测结果',
    'vision_tool_match_images': 'ORB 特征匹配可视化',
  }[name] || '可视化结果';
  div.innerHTML = `
    <img src="data:image/jpeg;base64,${b64}" alt="${friendlyLabel}" onclick="showLightbox(this.src)">
    <div class="vis-label">${friendlyLabel}</div>`;
  document.getElementById('chat-messages').appendChild(div);
  scrollChat();
};

/* ── Waterfall Trace ── */

App.createTraceBlock = function() {
  const block = document.createElement('div');
  block.className = 'trace-block open';
  block.innerHTML = `
    <div class="trace-header open">
      <span class="trace-chevron">▶</span>
      <span class="spinner"></span>
      <span class="trace-summary">Agent 执行中…</span>
      <span class="trace-count"></span>
      <span class="trace-time"></span>
    </div>
    <div class="trace-steps"></div>`;
  block.querySelector('.trace-header').addEventListener('click', function(e) {
    if (e.target.closest('.trace-save-skill-btn')) return;
    this.classList.toggle('open');
    block.classList.toggle('open');
  });
  document.getElementById('chat-messages').appendChild(block);
  scrollChat();
  return block;
};

App.addStepToTrace = function(trace, step) {
  const stepsEl = trace.querySelector('.trace-steps');
  const statusClass = 's-' + (step.status || 'running');
  const badgeClass = step.status || 'running';
  const badgeText = step.status === 'done' ? (step.elapsed_ms + 'ms')
                  : step.status === 'error' ? 'ERROR'
                  : '…';

  const el = document.createElement('div');
  el.className = `wf-step ${statusClass}`;
  el.innerHTML = `
    <div class="wf-step-head">
      <span class="wf-step-chevron">▶</span>
      <span class="wf-step-icon">${App.escapeHtml(step.icon || '•')}</span>
      <span class="wf-step-title">${App.escapeHtml(step.title)}</span>
      <span class="wf-step-sub">${App.escapeHtml(step.subtitle || '')}</span>
      <span class="wf-step-badge ${badgeClass}">${badgeText}</span>
    </div>
    <div class="wf-step-detail"><pre>${App.escapeHtml(step.detail || '')}</pre></div>`;

  const detailEl = el.querySelector('.wf-step-detail');
  if (step.llm_request) detailEl.appendChild(App.makeJsonPanel('📤 LLM Request (发送给模型)', 'req', step.llm_request));
  if (step.llm_response) detailEl.appendChild(App.makeJsonPanel('📥 LLM Response (模型返回)', 'res', step.llm_response));
  if (step.tool_args !== undefined) detailEl.appendChild(App.makeJsonPanel('📤 Tool Input (工具输入参数)', 'tool-in', { function: step.tool_name, arguments: step.tool_args }));
  if (step.tool_result !== undefined) detailEl.appendChild(App.makeJsonPanel('📥 Tool Output (工具返回数据)', 'tool-out', step.tool_result));

  el.querySelector('.wf-step-head').addEventListener('click', function() { el.classList.toggle('open'); });

  const prev = stepsEl.querySelector('.wf-step.s-running');
  if (prev && prev !== el) {
    prev.classList.remove('s-running');
    prev.classList.add('s-done');
    const prevBadge = prev.querySelector('.wf-step-badge');
    if (prevBadge) { prevBadge.classList.remove('running'); prevBadge.classList.add('done'); prevBadge.textContent = step.elapsed_ms + 'ms'; }
  }

  stepsEl.appendChild(el);
  trace.querySelector('.trace-count').textContent = `${stepsEl.children.length} 步骤`;
  scrollChat();
  return el;
};

App.finalizeTrace = function(trace, totalMs) {
  const header = trace.querySelector('.trace-header');
  const spinner = header.querySelector('.spinner');
  if (spinner) spinner.remove();
  trace.querySelector('.trace-summary').textContent = 'Agent 执行完成';
  trace.querySelector('.trace-time').textContent = totalMs + 'ms';
  header.classList.remove('open');
  trace.classList.remove('open');
  trace.querySelectorAll('.wf-step.s-running').forEach(s => {
    s.classList.remove('s-running');
    s.classList.add('s-done');
    const b = s.querySelector('.wf-step-badge');
    if (b) { b.classList.remove('running'); b.classList.add('done'); }
  });
};

App.setChatPipelineState = function(state) {
  if (state === 'user') App.setPipelineStep(0);
  else if (state === 'thinking') App.setPipelineStep(1);
  else if (state === 'tool-call') App.setPipelineStep(2);
  else if (state === 'tool-running') App.setPipelineStep(3);
  else if (state === 'tool-result') App.setPipelineStep(4);
  else if (state === 'answer') App.setPipelineStep(5);
};

/* ── Send Message ── */

App.sendMessage = async function() {
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const text = chatInput.value.trim();
  if (!text || App.state.isSending) return;

  App.state.isSending = true;
  btnSend.disabled = true;
  chatInput.value = '';
  App.state.selectedImages = [];
  document.querySelectorAll('.lib-card.selected').forEach(c => c.classList.remove('selected'));

  App.resetLastRunData();
  App.resetToolCallData();
  App.clearToolHighlights();
  App.state.lastRunData.userMessage = text;

  App.addUserMsg(text);
  App.state.chatHistory.push({ role: 'user', content: text });
  App.setChatPipelineState('user');
  App.refreshPipeDetailIfOpen();

  App.beaconSave();

  const trace = App.createTraceBlock();
  let lastTotalMs = 0;

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: App.state.chatHistory.slice(-10) }),
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let event;
        try { event = JSON.parse(jsonStr); } catch { continue; }

        switch (event.type) {
          case 'step': {
            App.addStepToTrace(trace, event);
            App.captureStepData(event);
            App.captureToolCallData(event);
            lastTotalMs = event.elapsed_ms || lastTotalMs;
            const icon = event.icon || '';
            if (icon === '📨') App.setChatPipelineState('user');
            else if (icon === '⚡') App.setChatPipelineState('thinking');
            else if (icon === '🧠') App.setChatPipelineState('thinking');
            else if (icon === '🎯' || icon === '💭') App.setChatPipelineState('thinking');
            else if (icon === '📋') {
              App.setChatPipelineState('tool-call');
              if (event.tool_name) App.highlightToolCard(event.tool_name);
            } else if (icon === '⚙️') {
              App.setChatPipelineState('tool-running');
              if (event.tool_name) App.highlightToolCard(event.tool_name);
            } else if (icon === '📊' || icon === '❌') App.setChatPipelineState('tool-result');
            else if (icon === '💡') App.setChatPipelineState('answer');
            else if (icon === '✅') App.setChatPipelineState('answer');
            App.refreshPipeDetailIfOpen();
            App.refreshToolDetailIfOpen();
            break;
          }
          case 'skill_execution': {
            const skillBadge = document.createElement('div');
            skillBadge.className = 'msg msg-status';
            skillBadge.innerHTML = `<div class="bubble" style="border-left:3px solid #a371f7;">⚡ 技能匹配：<strong>${App.escapeHtml(event.skill_name)}</strong> v${event.version}</div>`;
            document.getElementById('chat-messages').appendChild(skillBadge);
            scrollChat();
            break;
          }
          case 'visualization':
            App.addVisualization(event.name, event.image_base64);
            break;
          case 'answer':
            App.setChatPipelineState('answer');
            App.state.lastRunData.answer = event.content;
            App.finalizeTrace(trace, lastTotalMs);
            App.addAssistantMsg(event.content);
            App.state.chatHistory.push({ role: 'assistant', content: event.content });
            App.refreshPipeDetailIfOpen();
            App.refreshToolDetailIfOpen();
            App.beaconSave();
            break;
          case 'error':
            App.finalizeTrace(trace, lastTotalMs);
            App.addAssistantMsg('❌ ' + event.content);
            App.beaconSave();
            break;
          case 'done': {
            App.finalizeTrace(trace, lastTotalMs);
            App.buildDynamicPipeline(App.state.lastRunData.steps, true);
            App.refreshPipeDetailIfOpen();
            App.refreshToolDetailIfOpen();
            App.beaconSave();
            App.injectSaveSkillBtn(trace, App.state.lastRunData.steps);
            App.loadSkills();
            break;
          }
        }
      }
    }
  } catch (e) {
    App.finalizeTrace(trace, lastTotalMs);
    App.addAssistantMsg('❌ 网络错误: ' + e.message + '\n请确保 server.py 正在运行且 Ollama 服务已启动。');
  }

  App.state.isSending = false;
  btnSend.disabled = false;
  chatInput.focus();
  App.beaconSave();
  await App.doSave();
};

window.sendMessage = App.sendMessage;

/**
 * Inject a "Save as Skill" button into a trace header.
 * `steps` is an array of step objects (from lastRunData or reconstructed from DOM).
 * When steps is null (restored sessions), the button is always added
 * and will extract tool info from the DOM on click.
 */
App.injectSaveSkillBtn = function(traceBlock, steps) {
  const header = traceBlock.querySelector('.trace-header');
  if (!header) return;
  if (header.querySelector('.trace-save-skill-btn')) return;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'trace-save-skill-btn';
  saveBtn.textContent = '⚡ 保存为技能';
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (steps && steps.length > 0 && steps.some(s => s.tool_name)) {
      App.showCaptureModal(steps);
    } else {
      App._showCaptureFromDom(traceBlock);
    }
  });
  header.appendChild(saveBtn);
};

/**
 * Re-inject "Save as Skill" buttons on all trace blocks in restored chat HTML.
 * Also re-binds click handlers on any existing buttons from saved HTML snapshots.
 */
App.injectSaveSkillBtnsFromDom = function() {
  document.querySelectorAll('.trace-block').forEach(block => {
    const existingBtn = block.querySelector('.trace-save-skill-btn');
    if (existingBtn) {
      const freshBtn = existingBtn.cloneNode(true);
      existingBtn.replaceWith(freshBtn);
      freshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        App._showCaptureFromDom(block);
      });
    } else {
      App.injectSaveSkillBtn(block, null);
    }
  });
};

/**
 * Fallback capture when we only have DOM (restored conversations).
 * Reconstructs minimal step data from the trace block's step elements.
 */
App._showCaptureFromDom = function(traceBlock) {
  const pseudoSteps = [];
  traceBlock.querySelectorAll('.wf-step').forEach(stepEl => {
    const icon = stepEl.querySelector('.wf-step-icon')?.textContent.trim() || '';
    const title = stepEl.querySelector('.wf-step-title')?.textContent.trim() || '';
    const sub = stepEl.querySelector('.wf-step-sub')?.textContent.trim() || '';

    if (icon === '📋' || icon === '⚙️') {
      const fnMatch = sub.match(/(?:Preparing|Running)\s+(\w+)\(/);
      const toolName = fnMatch ? fnMatch[1] : '';
      if (toolName) {
        let toolArgs = null;
        const jsonPanels = stepEl.querySelectorAll('.json-panel');
        jsonPanels.forEach(panel => {
          const headText = panel.querySelector('.json-panel-head')?.textContent || '';
          if (headText.includes('Tool Input') || headText.includes('工具输入')) {
            const pre = panel.querySelector('pre');
            if (pre) {
              try { toolArgs = JSON.parse(pre.textContent); } catch {}
              if (toolArgs && toolArgs.arguments) toolArgs = toolArgs.arguments;
            }
          }
        });

        if (icon === '📋' && toolArgs) {
          pseudoSteps.push({ tool_name: toolName, tool_args: toolArgs, title });
        } else if (icon === '⚙️' && !pseudoSteps.some(s => s.tool_name === toolName)) {
          pseudoSteps.push({ tool_name: toolName, tool_args: toolArgs || {}, title });
        }
      }
    }
  });

  if (pseudoSteps.length === 0) {
    alert('无法从历史记录中提取工具调用信息。请尝试重新运行对话后保存。');
    return;
  }
  App.showCaptureModal(pseudoSteps);
};

App.initChatInput = function() {
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');

  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chatInput.value = btn.dataset.q;
      App.sendMessage();
    });
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      App.sendMessage();
    }
  });

  btnSend.addEventListener('click', (ev) => {
    ev.preventDefault();
    App.sendMessage();
  });
};
