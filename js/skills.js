/**
 * skills.js — Skill management: CRUD, capture workflow, toolbox sidebar list,
 *              keyword matching indicator, import/export.
 */
'use strict';

window.App = window.App || {};

/* ── API helpers ── */

App.loadSkills = async function() {
  try {
    const resp = await fetch('/api/skills');
    const data = await resp.json();
    App.state.skills = data.skills || [];
    App.state.skillsLoaded = true;
  } catch (e) {
    console.error('loadSkills error:', e);
    App.state.skills = [];
  }
  App.renderToolboxSkills();
  if (document.getElementById('tab-skills')?.classList.contains('active')) {
    App.renderSkillsTab();
  }
};

App.createSkill = async function(payload) {
  try {
    const resp = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.ok) {
      await App.loadSkills();
      return data;
    }
    return data;
  } catch (e) {
    console.error('createSkill error:', e);
    return { error: e.message };
  }
};

App.updateSkill = async function(skillId, payload) {
  try {
    const resp = await fetch(`/api/skills/${skillId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
};

App.deleteSkill = async function(skillId) {
  try {
    await fetch(`/api/skills/${skillId}`, { method: 'DELETE' });
    await App.loadSkills();
  } catch (e) {
    console.error('deleteSkill error:', e);
  }
};

App.addSkillVersion = async function(skillId, payload) {
  try {
    const resp = await fetch(`/api/skills/${skillId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
};

App.getSkillFull = async function(skillId) {
  try {
    const resp = await fetch(`/api/skills/${skillId}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
};

App.getSkillDiff = async function(skillId, v1, v2) {
  try {
    const resp = await fetch(`/api/skills/${skillId}/diff/${v1}/${v2}`);
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
};

App.captureSkillFromSteps = async function(steps) {
  try {
    const resp = await fetch('/api/skills/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps }),
    });
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
};

App.importSkill = async function(skillJson) {
  try {
    const resp = await fetch('/api/skills/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillJson),
    });
    const data = await resp.json();
    if (data.ok) await App.loadSkills();
    return data;
  } catch (e) {
    return { error: e.message };
  }
};

App.exportSkill = async function(skillId) {
  const skill = await App.getSkillFull(skillId);
  if (!skill) return;
  const blob = new Blob([JSON.stringify(skill, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `skill_${skillId}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

/* ── Toolbox panel skills list ── */

App.renderToolboxSkills = function() {
  const container = document.getElementById('skills-list');
  if (!container) return;
  const skills = App.state.skills;
  if (!skills.length) {
    container.innerHTML = '<div class="skill-empty">暂无技能 · 完成对话后可保存为技能</div>';
    return;
  }
  container.innerHTML = skills.map(s => {
    const kwBadges = (s.keywords || []).slice(0, 3).map(k =>
      `<span class="skill-kw-badge">${App.escapeHtml(k)}</span>`
    ).join('');
    const enabledClass = s.enabled ? '' : ' skill-disabled';
    return `<div class="skill-card${enabledClass}" data-skill-id="${App.escapeHtml(s.id)}">
      <div class="skill-card-top">
        <span class="skill-card-icon">⚡</span>
        <span class="skill-card-name">${App.escapeHtml(s.name)}</span>
        <span class="skill-card-ver">v${s.active_version || 1}</span>
      </div>
      <div class="skill-card-kw">${kwBadges}</div>
      <div class="skill-card-stats">
        <span title="执行次数">▶ ${s.execution_count || 0}</span>
        <span class="skill-card-toggle" data-skill-id="${App.escapeHtml(s.id)}" title="${s.enabled ? '禁用' : '启用'}">${s.enabled ? '🟢' : '🔴'}</span>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.skill-card').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.skill-card-toggle')) return;
      const skillId = el.dataset.skillId;
      App.showSkillDetailInToolbox(skillId);
    });
  });

  container.querySelectorAll('.skill-card-toggle').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const skillId = el.dataset.skillId;
      const skill = App.state.skills.find(s => s.id === skillId);
      if (!skill) return;
      await App.updateSkill(skillId, { enabled: !skill.enabled });
      await App.loadSkills();
    });
  });
};

App.showSkillDetailInToolbox = function(skillId) {
  const skill = App.state.skills.find(s => s.id === skillId);
  if (!skill) return;
  const toolDetailEl = document.getElementById('tool-detail');

  const kwHtml = (skill.keywords || []).map(k =>
    `<span class="skill-kw-badge">${App.escapeHtml(k)}</span>`
  ).join(' ');
  const instrStatus = skill.has_instructions
    ? '<span style="color:#3fb950;">✓ LLM 驱动</span>'
    : '<span style="color:#d29922;">⚠ 无指令</span>';

  toolDetailEl.innerHTML = `
    <div class="tool-detail-header" style="border-left:3px solid #a371f7;">
      <span class="tool-detail-icon">⚡</span>
      <span class="tool-detail-title">${App.escapeHtml(skill.name)}</span>
      <button class="tool-detail-close" id="tool-detail-close">✕</button>
    </div>
    <div style="font-size:0.65rem;color:#a371f7;font-family:'SF Mono','Fira Code',monospace;margin-bottom:8px;">${App.escapeHtml(skill.id)} · v${skill.active_version || 1}</div>
    <div class="tool-detail-body">
      <div class="td-section"><div class="td-label">📖 描述</div>${App.escapeHtml(skill.description || '—')}</div>
      <div class="td-section"><div class="td-label">🏷️ 触发关键词</div>${kwHtml || '<span style="color:#484f58;">未设置</span>'}</div>
      <div class="td-section"><div class="td-label">🧠 执行模式</div>${instrStatus}</div>
      <div class="td-section"><div class="td-label">📊 统计</div>
        <div class="live-row"><span class="live-label">执行次数</span><span class="live-value">${skill.execution_count || 0}</span></div>
        <div class="live-row"><span class="live-label">最近执行</span><span class="live-value">${skill.last_executed_at || '从未'}</span></div>
      </div>
      <div class="td-section" style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="skill-action-btn" onclick="App.navigateToSkillDetail('${App.escapeHtml(skill.id)}')">📄 详情与版本</button>
        <button class="skill-action-btn" onclick="App.exportSkill('${App.escapeHtml(skill.id)}')">📤 导出</button>
        <button class="skill-action-btn danger" onclick="if(confirm('确定删除？'))App.deleteSkill('${App.escapeHtml(skill.id)}')">🗑️ 删除</button>
      </div>
    </div>`;
  toolDetailEl.classList.add('show');
  App.state.currentDetailTool = null;
  document.getElementById('tool-detail-close').addEventListener('click', (e) => {
    e.stopPropagation();
    toolDetailEl.classList.remove('show');
  });
};

App.navigateToSkillDetail = function(skillId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const btn = document.querySelector('.tab-btn[data-tab="skills"]');
  if (btn) btn.classList.add('active');
  const tab = document.getElementById('tab-skills');
  if (tab) tab.classList.add('active');
  document.getElementById('tool-detail').classList.remove('show');
  App.state.currentSkillDetail = skillId;
  App.renderSkillsTab();
};

/* ── Skills Tab rendering ── */

App.renderSkillsTab = function() {
  const container = document.getElementById('skills-tab-content');
  if (!container) return;

  if (App.state.currentSkillDetail) {
    App.renderSkillDetailPage(App.state.currentSkillDetail);
    return;
  }

  const skills = App.state.skills;
  const filter = (App.state.skillsTabFilter || '').toLowerCase();
  const filtered = filter
    ? skills.filter(s =>
        s.name.toLowerCase().includes(filter) ||
        (s.keywords || []).some(k => k.toLowerCase().includes(filter)) ||
        s.id.toLowerCase().includes(filter)
      )
    : skills;

  const isCard = App.state.skillsTabView === 'card';

  let statsHtml = '';
  const totalExec = skills.reduce((a, s) => a + (s.execution_count || 0), 0);
  const enabledCount = skills.filter(s => s.enabled).length;
  statsHtml = `<div class="skills-tab-stats">
    <span class="stat-chip">⚡ 技能 <span class="stat-val">${skills.length}</span></span>
    <span class="stat-chip">🟢 启用 <span class="stat-val">${enabledCount}</span></span>
    <span class="stat-chip">▶ 总执行 <span class="stat-val">${totalExec}</span></span>
  </div>`;

  let controlsHtml = `<div class="skills-tab-controls">
    <input type="text" id="skills-filter-input" class="skills-filter" placeholder="搜索技能名称、关键词…" value="${App.escapeHtml(App.state.skillsTabFilter || '')}">
    <div class="skills-view-toggle">
      <button class="skills-view-btn ${isCard ? 'active' : ''}" data-view="card" title="卡片视图">▦</button>
      <button class="skills-view-btn ${!isCard ? 'active' : ''}" data-view="table" title="表格视图">☰</button>
    </div>
    <button class="skill-action-btn" id="btn-import-skill">📥 导入</button>
  </div>`;

  let bodyHtml = '';
  if (!filtered.length) {
    bodyHtml = '<div class="skill-empty" style="padding:40px 0;">暂无技能 · 在对话中完成一次工具调用后可以保存为技能</div>';
  } else if (isCard) {
    bodyHtml = '<div class="skills-card-grid">' + filtered.map(s => {
      const kwBadges = (s.keywords || []).slice(0, 4).map(k =>
        `<span class="skill-kw-badge">${App.escapeHtml(k)}</span>`
      ).join('');
      return `<div class="skill-tab-card${s.enabled ? '' : ' skill-disabled'}" data-skill-id="${App.escapeHtml(s.id)}">
        <div class="skill-tab-card-head">
          <span class="skill-tab-card-icon">⚡</span>
          <span class="skill-tab-card-name">${App.escapeHtml(s.name)}</span>
          <span class="skill-card-ver">v${s.active_version || 1}</span>
        </div>
        <div class="skill-tab-card-desc">${App.escapeHtml(s.description || '—')}</div>
        <div class="skill-card-kw">${kwBadges}</div>
        <div class="skill-tab-card-foot">
          <span>▶ ${s.execution_count || 0} 次</span>
          <span>${s.last_executed_at ? s.last_executed_at.slice(5, 16) : '未执行'}</span>
          <span class="skill-card-toggle" data-skill-id="${App.escapeHtml(s.id)}">${s.enabled ? '🟢' : '🔴'}</span>
        </div>
      </div>`;
    }).join('') + '</div>';
  } else {
    bodyHtml = `<table class="skills-table">
      <thead><tr><th>名称</th><th>关键词</th><th>版本</th><th>执行</th><th>最近使用</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${filtered.map(s => {
        const kwStr = (s.keywords || []).join(', ');
        return `<tr class="${s.enabled ? '' : 'skill-disabled'}" data-skill-id="${App.escapeHtml(s.id)}">
          <td><strong>${App.escapeHtml(s.name)}</strong></td>
          <td class="skills-table-kw">${App.escapeHtml(kwStr)}</td>
          <td>v${s.active_version || 1} <span style="color:#484f58;">(${s.version_count}个)</span></td>
          <td>${s.execution_count || 0}</td>
          <td>${s.last_executed_at ? s.last_executed_at.slice(5, 16) : '—'}</td>
          <td><span class="skill-card-toggle" data-skill-id="${App.escapeHtml(s.id)}">${s.enabled ? '🟢' : '🔴'}</span></td>
          <td>
            <button class="skill-action-btn small" onclick="event.stopPropagation();App.exportSkill('${App.escapeHtml(s.id)}')">📤</button>
            <button class="skill-action-btn small danger" onclick="event.stopPropagation();if(confirm('确定删除？'))App.deleteSkill('${App.escapeHtml(s.id)}')">🗑️</button>
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  container.innerHTML = statsHtml + controlsHtml + bodyHtml;

  document.getElementById('skills-filter-input')?.addEventListener('input', (e) => {
    App.state.skillsTabFilter = e.target.value;
    App.renderSkillsTab();
  });

  container.querySelectorAll('.skills-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      App.state.skillsTabView = btn.dataset.view;
      App.renderSkillsTab();
    });
  });

  container.querySelectorAll('.skill-tab-card, .skills-table tbody tr').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.skill-card-toggle') || e.target.closest('.skill-action-btn')) return;
      App.state.currentSkillDetail = el.dataset.skillId;
      App.renderSkillsTab();
    });
  });

  container.querySelectorAll('.skill-card-toggle').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = el.dataset.skillId;
      const s = App.state.skills.find(x => x.id === sid);
      if (!s) return;
      await App.updateSkill(sid, { enabled: !s.enabled });
      await App.loadSkills();
    });
  });

  document.getElementById('btn-import-skill')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const result = await App.importSkill(data);
        if (result.ok) alert('导入成功！');
        else alert('导入失败：' + (result.error || 'unknown'));
      } catch (e) {
        alert('文件解析失败：' + e.message);
      }
    });
    input.click();
  });
};

/* ── Capture modal ── */

App.showCaptureModal = async function(steps) {
  const overlay = document.getElementById('skill-capture-overlay');
  const modalBody = document.getElementById('capture-modal-body');
  modalBody.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div> 正在使用 LLM 生成技能指令…</div>';
  overlay.classList.add('show');

  const draft = await App.captureSkillFromSteps(steps);
  if (draft.error) {
    alert('提取技能失败：' + draft.error);
    overlay.classList.remove('show');
    return;
  }
  if (!draft.system_prompt_addon) {
    alert('此对话没有可提取的工具调用');
    overlay.classList.remove('show');
    return;
  }
  App.state.skillCaptureDraft = draft;

  const workflowPreview = (draft.suggested_workflow || []).map((s, i) =>
    `<div class="capture-step">
      <span class="capture-step-num">${i + 1}</span>
      <span class="capture-step-tool">${App.escapeHtml(s.tool)}</span>
      <span class="capture-step-desc">${App.escapeHtml(s.description || '')}</span>
    </div>`
  ).join('');

  const llmBadge = draft.llm_generated
    ? '<span style="color:#3fb950;font-size:0.68rem;margin-left:6px;">✓ LLM 生成</span>'
    : '<span style="color:#d29922;font-size:0.68rem;margin-left:6px;">⚠ 机械生成（LLM 不可用）</span>';

  modalBody.innerHTML = `
    <div class="capture-field">
      <label>技能名称 · Skill Name</label>
      <input type="text" id="capture-name" placeholder="例如：对比查找" value="">
    </div>
    <div class="capture-field">
      <label>描述 · Description</label>
      <input type="text" id="capture-desc" placeholder="简短描述这个技能做什么" value="">
    </div>
    <div class="capture-field">
      <label>触发关键词 · Keywords <span style="color:#484f58;font-size:0.68rem;">(逗号分隔)</span></label>
      <input type="text" id="capture-keywords" placeholder="例如：比较搜索, compare search" value="">
    </div>
    <div class="capture-field">
      <label>技能指令 · Skill Instructions ${llmBadge}</label>
      <textarea id="capture-instructions" class="skill-instructions-editor" rows="10" placeholder="LLM 将根据这些指令决定如何调用工具…">${App.escapeHtml(draft.system_prompt_addon)}</textarea>
      <div style="font-size:0.65rem;color:#484f58;margin-top:4px;">这段指令会注入系统提示，引导 LLM 自主选择和调用工具。可以自由编辑。</div>
    </div>
    <div class="capture-field">
      <label>参考工作流 · Suggested Workflow (${draft.tool_count} 步)</label>
      <div class="capture-steps-list">${workflowPreview}</div>
      <div style="font-size:0.65rem;color:#484f58;margin-top:4px;">仅供参考。LLM 会根据指令自行决定实际工具调用。</div>
    </div>`;
};

App.confirmCapture = async function() {
  const draft = App.state.skillCaptureDraft;
  if (!draft) return;

  const name = document.getElementById('capture-name')?.value.trim();
  const desc = document.getElementById('capture-desc')?.value.trim();
  const kwStr = document.getElementById('capture-keywords')?.value.trim();
  const instructions = document.getElementById('capture-instructions')?.value.trim();
  if (!name) { alert('请输入技能名称'); return; }
  if (!instructions) { alert('请输入技能指令'); return; }

  const keywords = kwStr ? kwStr.split(/[,，]/).map(k => k.trim()).filter(Boolean) : [];
  const result = await App.createSkill({
    name,
    description: desc || '',
    keywords,
    system_prompt_addon: instructions,
    suggested_workflow: draft.suggested_workflow || [],
    changelog: 'Captured from conversation',
  });

  if (result.ok) {
    document.getElementById('skill-capture-overlay').classList.remove('show');
    App.state.skillCaptureDraft = null;
    await App.loadSkills();
  } else {
    alert('保存失败：' + (result.error || 'unknown'));
  }
};

App.closeCaptureModal = function() {
  document.getElementById('skill-capture-overlay').classList.remove('show');
  App.state.skillCaptureDraft = null;
};

/* ── Init ── */

App.initSkills = function() {
  App.loadSkills();
};
