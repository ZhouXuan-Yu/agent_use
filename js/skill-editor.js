/**
 * skill-editor.js — Skill detail page: rendered instructions (markdown),
 *                    suggested workflow timeline, version history,
 *                    side-by-side diff viewer, inline edit mode.
 *
 * Skills are LLM-driven: the primary content is `system_prompt_addon`
 * (natural-language instructions injected into the system prompt).
 * `suggested_workflow` is a reference-only timeline of tool steps.
 */
'use strict';

window.App = window.App || {};

const SKILL_TOOL_ZH = {
  'list_available_images': '列出可用图像',
  'vision_tool_detect_keypoints': '检测 ORB 关键点',
  'vision_tool_match_images': '比较两张图像',
  'vision_tool_compare_multiple': '批量图像检索',
};

/* ── Skill detail page (rendered inside #skills-tab-content) ── */

App.renderSkillDetailPage = async function(skillId) {
  const container = document.getElementById('skills-tab-content');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:40px;"><div class="spinner"></div> 加载中…</div>';

  const skill = await App.getSkillFull(skillId);
  if (!skill) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#f85149;">技能未找到</div>';
    return;
  }

  const versions = skill.versions || [];
  const activeVer = versions.find(v => v.version === skill.active_version) || versions[versions.length - 1];

  container.innerHTML = `
    <div class="skill-detail-page">
      ${_renderDetailHeader(skill)}
      <div class="skill-detail-body">
        <div class="skill-detail-main">
          ${_renderInstructions(skill, activeVer)}
          ${_renderWorkflowTimeline(activeVer)}
          ${_renderMarkdownDoc(skill, activeVer)}
        </div>
        <div class="skill-detail-sidebar">
          ${_renderVersionTimeline(skill, versions)}
          ${_renderExecutionLog(skill)}
        </div>
      </div>
      <div class="skill-diff-area" id="skill-diff-area"></div>
    </div>`;

  _bindDetailEvents(skill, container);
};

function _renderDetailHeader(skill) {
  const kwHtml = (skill.keywords || []).map(k =>
    `<span class="skill-kw-badge editable" data-kw="${App.escapeHtml(k)}">${App.escapeHtml(k)} <span class="kw-remove" title="移除">×</span></span>`
  ).join(' ');

  return `<div class="skill-detail-header">
    <button class="skill-back-btn" id="skill-back-btn">← 返回列表</button>
    <div class="skill-detail-title-row">
      <span class="skill-detail-icon">⚡</span>
      <h2 class="skill-detail-name" id="skill-detail-name" title="双击编辑名称">${App.escapeHtml(skill.name)}</h2>
      <span class="skill-detail-id">${App.escapeHtml(skill.id)}</span>
      <span class="skill-card-ver">v${skill.active_version || 1}</span>
      <span class="skill-detail-mode">🧠 LLM 驱动</span>
      <span class="skill-card-toggle" id="skill-detail-toggle" data-enabled="${skill.enabled}">${skill.enabled ? '🟢 启用' : '🔴 禁用'}</span>
    </div>
    <div class="skill-detail-desc" id="skill-detail-desc" title="双击编辑描述">${App.escapeHtml(skill.description || '点击添加描述…')}</div>
    <div class="skill-detail-keywords">
      <span class="td-label" style="margin-right:6px;">🏷️ 关键词</span>
      ${kwHtml}
      <button class="skill-kw-add-btn" id="skill-kw-add-btn" title="添加关键词">+</button>
    </div>
    <div class="skill-detail-actions">
      <button class="skill-action-btn" id="btn-edit-skill">✏️ 编辑指令</button>
      <button class="skill-action-btn" onclick="App.exportSkill('${App.escapeHtml(skill.id)}')">📤 导出 JSON</button>
      <button class="skill-action-btn danger" id="btn-delete-skill">🗑️ 删除技能</button>
    </div>
  </div>`;
}

function _renderInstructions(skill, version) {
  const addon = version?.system_prompt_addon || '';
  if (!addon) {
    return `<div class="skill-instructions-section">
      <h3>🧠 技能指令 · Instructions <span style="color:#484f58;font-weight:400;">(v${version?.version || '?'})</span></h3>
      <div class="skill-empty">此版本没有技能指令。请编辑添加。</div>
    </div>`;
  }

  const rendered = App.formatMarkdown ? App.formatMarkdown(addon) : addon.replace(/\n/g, '<br>');

  return `<div class="skill-instructions-section">
    <h3>🧠 技能指令 · Instructions <span style="color:#484f58;font-weight:400;">(v${version.version})</span></h3>
    <div class="skill-instructions-rendered">${rendered}</div>
    <div style="font-size:0.65rem;color:#484f58;margin-top:6px;">当技能被触发时，这段指令会注入系统提示，LLM 据此自主决定工具调用。</div>
  </div>`;
}

function _renderWorkflowTimeline(version) {
  const workflow = version?.suggested_workflow || version?.steps || [];
  if (!workflow.length) return '';

  const stepsHtml = workflow.map((s, i) => {
    const toolName = s.tool || '';
    const toolZh = SKILL_TOOL_ZH[toolName] || toolName;
    const desc = s.description || '';

    return `<div class="skill-step-node">
      <div class="skill-step-connector">${i < workflow.length - 1 ? '<div class="step-line"></div>' : ''}</div>
      <div class="skill-step-dot">${i + 1}</div>
      <div class="skill-step-content">
        <div class="skill-step-tool">${App.escapeHtml(toolZh)}</div>
        <div class="skill-step-fn">${App.escapeHtml(toolName)}</div>
        ${desc ? `<div class="skill-step-desc">${App.escapeHtml(desc)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div class="skill-steps-viz">
    <h3>📋 参考工作流 · Suggested Workflow <span style="color:#484f58;font-weight:400;">(${workflow.length} 步)</span></h3>
    <div style="font-size:0.65rem;color:#484f58;margin-bottom:8px;">仅供参考。LLM 根据指令自行决定实际工具调用顺序和参数。</div>
    <div class="skill-steps-timeline">${stepsHtml}</div>
  </div>`;
}

function _renderMarkdownDoc(skill, version) {
  let md = `## ⚡ ${skill.name}\n\n`;
  md += `${skill.description || ''}\n\n`;
  md += `**ID:** \`${skill.id}\` · **版本:** v${version.version} · **状态:** ${skill.enabled ? '启用' : '禁用'} · **模式:** LLM 驱动\n\n`;

  if (skill.keywords && skill.keywords.length) {
    md += `**触发关键词:** ${skill.keywords.map(k => `\`${k}\``).join(', ')}\n\n`;
  }

  if (skill.execution_count) {
    md += `### 统计\n\n`;
    md += `- 执行次数: **${skill.execution_count}**\n`;
    md += `- 最近执行: ${skill.last_executed_at || '—'}\n`;
  }

  const rendered = App.formatMarkdown ? App.formatMarkdown(md) : md.replace(/\n/g, '<br>');

  return `<div class="skill-markdown-content">
    <h3>📄 技能文档 · Documentation</h3>
    <div class="skill-md-rendered">${rendered}</div>
  </div>`;
}

function _renderVersionTimeline(skill, versions) {
  if (!versions.length) return '';

  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const items = sorted.map(v => {
    const isActive = v.version === skill.active_version;
    const hasInstr = !!v.system_prompt_addon;
    return `<div class="version-item${isActive ? ' active' : ''}" data-ver="${v.version}">
      <div class="version-dot${isActive ? ' active' : ''}"></div>
      <div class="version-info">
        <div class="version-label">v${v.version}${isActive ? ' <span class="version-active-badge">当前</span>' : ''} ${hasInstr ? '<span style="color:#3fb950;font-size:0.65rem;">🧠</span>' : ''}</div>
        <div class="version-meta">${App.escapeHtml(v.created_at || '—')}</div>
        ${v.changelog ? `<div class="version-changelog">${App.escapeHtml(v.changelog)}</div>` : ''}
        <div class="version-actions">
          ${!isActive ? `<button class="version-btn" data-action="restore" data-ver="${v.version}">恢复此版本</button>` : ''}
          <button class="version-btn" data-action="diff" data-ver="${v.version}">对比</button>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="skill-version-panel">
    <h3>🕰️ 版本历史 · Versions (${versions.length})</h3>
    <div class="version-timeline">${items}</div>
    <div class="version-diff-selector" id="version-diff-selector" style="display:none;">
      <label>对比：</label>
      <select id="diff-v1">${sorted.map(v => `<option value="${v.version}">v${v.version}</option>`).join('')}</select>
      <span>↔</span>
      <select id="diff-v2">${sorted.map(v => `<option value="${v.version}"${v.version === (sorted[1]?.version || sorted[0].version) ? ' selected' : ''}>v${v.version}</option>`).join('')}</select>
      <button class="skill-action-btn small" id="btn-run-diff">查看 Diff</button>
    </div>
  </div>`;
}

function _renderExecutionLog(skill) {
  const log = skill.execution_log || [];
  if (!log.length) return '';
  const recent = log.slice(-10).reverse();
  return `<div class="skill-exec-log">
    <h3>📊 执行记录 · Recent Runs</h3>
    <div class="exec-log-list">${recent.map(entry => `
      <div class="exec-log-item ${entry.success ? '' : 'failed'}">
        <span class="exec-log-status">${entry.success ? '✓' : '✗'}</span>
        <span class="exec-log-time">${App.escapeHtml((entry.at || '').slice(5, 16))}</span>
        <span class="exec-log-dur">${entry.duration_ms || 0}ms</span>
        <span class="exec-log-params">${App.escapeHtml(entry.context || JSON.stringify(entry.params || {}))}</span>
      </div>
    `).join('')}</div>
  </div>`;
}

/* ── Diff viewer ── */

App.renderDiffViewer = async function(skillId, v1, v2) {
  const area = document.getElementById('skill-diff-area');
  if (!area) return;
  area.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner"></div> 计算差异…</div>';

  const data = await App.getSkillDiff(skillId, v1, v2);
  if (data.error) {
    area.innerHTML = `<div style="color:#f85149;padding:20px;">Diff 失败：${App.escapeHtml(data.error)}</div>`;
    return;
  }

  const diffLines = data.diff || [];
  if (!diffLines.length) {
    area.innerHTML = '<div style="padding:20px;color:#3fb950;">两个版本完全相同，无差异。</div>';
    return;
  }

  const textA = data.version_a?.system_prompt_addon || JSON.stringify(data.version_a?.steps || [], null, 2);
  const textB = data.version_b?.system_prompt_addon || JSON.stringify(data.version_b?.steps || [], null, 2);
  const leftLines = textA.split('\n');
  const rightLines = textB.split('\n');

  let unifiedHtml = diffLines.map(line => {
    const escaped = App.escapeHtml(line);
    if (line.startsWith('+++') || line.startsWith('---')) {
      return `<div class="diff-line diff-header">${escaped}</div>`;
    } else if (line.startsWith('@@')) {
      return `<div class="diff-line diff-range">${escaped}</div>`;
    } else if (line.startsWith('+')) {
      return `<div class="diff-line diff-add">${escaped}</div>`;
    } else if (line.startsWith('-')) {
      return `<div class="diff-line diff-remove">${escaped}</div>`;
    }
    return `<div class="diff-line">${escaped}</div>`;
  }).join('');

  let sideBySideHtml = _buildSideBySide(leftLines, rightLines);

  area.innerHTML = `
    <div class="diff-viewer">
      <div class="diff-header-bar">
        <h3>🔀 版本对比 · v${v1} ↔ v${v2}</h3>
        <div class="diff-mode-toggle">
          <button class="diff-mode-btn active" data-mode="unified">统一视图</button>
          <button class="diff-mode-btn" data-mode="side">并排视图</button>
        </div>
        <button class="diff-close-btn" id="diff-close-btn">✕ 关闭</button>
      </div>
      <div class="diff-content" id="diff-content-unified">${unifiedHtml}</div>
      <div class="diff-content diff-side-by-side" id="diff-content-side" style="display:none;">${sideBySideHtml}</div>
    </div>`;

  area.querySelectorAll('.diff-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      area.querySelectorAll('.diff-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('diff-content-unified').style.display = mode === 'unified' ? '' : 'none';
      document.getElementById('diff-content-side').style.display = mode === 'side' ? '' : 'none';
    });
  });

  document.getElementById('diff-close-btn')?.addEventListener('click', () => {
    area.innerHTML = '';
  });
};

function _buildSideBySide(leftLines, rightLines) {
  let leftHtml = leftLines.map((l, i) =>
    `<div class="diff-line diff-remove"><span class="diff-ln">${i + 1}</span>${App.escapeHtml(l)}</div>`
  ).join('');
  let rightHtml = rightLines.map((l, i) =>
    `<div class="diff-line diff-add"><span class="diff-ln">${i + 1}</span>${App.escapeHtml(l)}</div>`
  ).join('');
  return `<div class="diff-pane diff-pane-left"><div class="diff-pane-title">旧版本</div>${leftHtml}</div>
          <div class="diff-pane diff-pane-right"><div class="diff-pane-title">新版本</div>${rightHtml}</div>`;
}

/* ── Edit mode — now edits instructions text, not JSON steps ── */

App.openSkillEditor = async function(skillId) {
  const skill = await App.getSkillFull(skillId);
  if (!skill) return;

  const versions = skill.versions || [];
  const activeVer = versions.find(v => v.version === skill.active_version) || versions[versions.length - 1];
  if (!activeVer) return;

  const instructions = activeVer.system_prompt_addon || '';
  const container = document.getElementById('skills-tab-content');

  container.innerHTML = `
    <div class="skill-edit-page">
      <div class="skill-detail-header">
        <button class="skill-back-btn" id="skill-edit-cancel">← 取消</button>
        <h2>✏️ 编辑技能指令 · ${App.escapeHtml(skill.name)} v${activeVer.version}</h2>
      </div>
      <div class="capture-field">
        <label>变更说明 · Changelog</label>
        <input type="text" id="edit-changelog" placeholder="描述你的修改…" value="">
      </div>
      <div class="capture-field">
        <label>技能指令 · Instructions（编辑后保存将创建新版本）</label>
        <textarea id="edit-instructions" class="skill-instructions-editor" rows="16">${App.escapeHtml(instructions)}</textarea>
        <div style="font-size:0.65rem;color:#484f58;margin-top:4px;">这段指令在技能触发时注入系统提示，引导 LLM 自主选择和调用工具。</div>
      </div>
      <div class="skill-detail-actions">
        <button class="skill-action-btn primary" id="btn-save-edit">💾 保存为新版本</button>
        <button class="skill-action-btn" id="skill-edit-cancel-2">取消</button>
      </div>
    </div>`;

  const goBack = () => { App.state.currentSkillDetail = skillId; App.renderSkillsTab(); };
  document.getElementById('skill-edit-cancel')?.addEventListener('click', goBack);
  document.getElementById('skill-edit-cancel-2')?.addEventListener('click', goBack);

  document.getElementById('btn-save-edit')?.addEventListener('click', async () => {
    const newInstructions = document.getElementById('edit-instructions').value.trim();
    if (!newInstructions) {
      alert('指令不能为空');
      return;
    }
    const changelog = document.getElementById('edit-changelog')?.value.trim() || 'Manual edit';
    const result = await App.addSkillVersion(skillId, {
      system_prompt_addon: newInstructions,
      suggested_workflow: activeVer.suggested_workflow || activeVer.steps || [],
      changelog,
    });
    if (result.ok) {
      await App.loadSkills();
      App.state.currentSkillDetail = skillId;
      App.renderSkillsTab();
    } else {
      alert('保存失败：' + (result.error || 'unknown'));
    }
  });
};

/* ── Event bindings for detail page ── */

function _bindDetailEvents(skill, container) {
  document.getElementById('skill-back-btn')?.addEventListener('click', () => {
    App.state.currentSkillDetail = null;
    App.renderSkillsTab();
  });

  document.getElementById('btn-edit-skill')?.addEventListener('click', () => {
    App.openSkillEditor(skill.id);
  });

  document.getElementById('btn-delete-skill')?.addEventListener('click', async () => {
    if (confirm(`确定删除技能「${skill.name}」？此操作不可恢复。`)) {
      await App.deleteSkill(skill.id);
      App.state.currentSkillDetail = null;
      App.renderSkillsTab();
    }
  });

  document.getElementById('skill-detail-toggle')?.addEventListener('click', async () => {
    await App.updateSkill(skill.id, { enabled: !skill.enabled });
    await App.loadSkills();
    App.renderSkillDetailPage(skill.id);
  });

  const nameEl = document.getElementById('skill-detail-name');
  if (nameEl) {
    nameEl.addEventListener('dblclick', () => {
      const current = nameEl.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.className = 'skill-inline-edit';
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = async () => {
        const val = input.value.trim();
        if (val && val !== current) {
          await App.updateSkill(skill.id, { name: val });
          await App.loadSkills();
        }
        App.renderSkillDetailPage(skill.id);
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  }

  const descEl = document.getElementById('skill-detail-desc');
  if (descEl) {
    descEl.addEventListener('dblclick', () => {
      const current = skill.description || '';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.className = 'skill-inline-edit';
      input.placeholder = '输入描述…';
      descEl.replaceWith(input);
      input.focus();
      const commit = async () => {
        const val = input.value.trim();
        if (val !== current) {
          await App.updateSkill(skill.id, { description: val });
          await App.loadSkills();
        }
        App.renderSkillDetailPage(skill.id);
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  }

  container.querySelectorAll('.kw-remove').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const kw = el.closest('.skill-kw-badge')?.dataset.kw;
      if (!kw) return;
      const newKw = (skill.keywords || []).filter(k => k !== kw);
      await App.updateSkill(skill.id, { keywords: newKw });
      await App.loadSkills();
      App.renderSkillDetailPage(skill.id);
    });
  });

  document.getElementById('skill-kw-add-btn')?.addEventListener('click', () => {
    const val = prompt('输入新关键词：');
    if (!val || !val.trim()) return;
    const newKw = [...(skill.keywords || []), val.trim()];
    App.updateSkill(skill.id, { keywords: newKw }).then(() => {
      App.loadSkills().then(() => App.renderSkillDetailPage(skill.id));
    });
  });

  container.querySelectorAll('[data-action="restore"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ver = +btn.dataset.ver;
      if (confirm(`恢复到 v${ver}？`)) {
        await App.updateSkill(skill.id, { active_version: ver });
        await App.loadSkills();
        App.renderSkillDetailPage(skill.id);
      }
    });
  });

  container.querySelectorAll('[data-action="diff"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const selector = document.getElementById('version-diff-selector');
      if (selector) {
        selector.style.display = selector.style.display === 'none' ? 'flex' : 'none';
        const v1Sel = document.getElementById('diff-v1');
        if (v1Sel) v1Sel.value = btn.dataset.ver;
      }
    });
  });

  document.getElementById('btn-run-diff')?.addEventListener('click', () => {
    const v1 = +(document.getElementById('diff-v1')?.value || 0);
    const v2 = +(document.getElementById('diff-v2')?.value || 0);
    if (v1 && v2 && v1 !== v2) {
      App.renderDiffViewer(skill.id, v1, v2);
    } else {
      alert('请选择两个不同的版本');
    }
  });
}
