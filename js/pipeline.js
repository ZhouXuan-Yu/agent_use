/**
 * pipeline.js — Dynamic pipeline flow strip & phase detail panel.
 */
'use strict';

window.App = window.App || {};

const TOOL_ZH = {
  'list_available_images': '列出可用图像',
  'vision_tool_detect_keypoints': '检测 ORB 关键点',
  'vision_tool_match_images': '比较两张图像',
  'vision_tool_compare_multiple': '批量图像检索',
};
function toolZh(name) { return TOOL_ZH[name] || name; }

App.aggregateStepsIntoPhases = function(steps) {
  const phases = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if (s.icon === '📨') {
      phases.push({ icon: '💬', title: '用户提问', subtitle: s.subtitle, status: s.status, childIndices: [i], elapsed_ms: s.elapsed_ms });
      i++;
    } else if (s.icon === '🧠') {
      const phase = { icon: '🧠', title: s.title, subtitle: s.subtitle, status: 'running', childIndices: [i], elapsed_ms: null };
      const roundNum = s.round || '';
      i++;
      while (i < steps.length && steps[i].icon !== '🧠' && steps[i].icon !== '💡' && steps[i].icon !== '✅' && steps[i].icon !== '❌') {
        phase.childIndices.push(i);
        i++;
      }
      if (i < steps.length && steps[i].icon === '💡') {
        phase.childIndices.push(i);
        i++;
      }
      const lastChild = steps[phase.childIndices[phase.childIndices.length - 1]];
      phase.elapsed_ms = lastChild.elapsed_ms;
      const toolSteps = phase.childIndices.filter(ci => steps[ci].icon === '⚙️');
      const toolNames = toolSteps.map(ci => {
        const tn = steps[ci].tool_name;
        return tn ? tn.replace('vision_tool_', '') : '?';
      });
      const hasError = phase.childIndices.some(ci => steps[ci].status === 'error');
      const allDone = phase.childIndices.every(ci => steps[ci].status === 'done');
      phase.status = hasError ? 'error' : allDone ? 'done' : 'running';
      if (toolNames.length > 0) {
        phase.title = `第${roundNum}轮 → ${toolNames.join(', ')}`;
        phase.icon = '🔧';
      } else {
        phase.title = `LLM 推理（第${roundNum}轮）`;
      }
      phase.stepCount = phase.childIndices.length;
      phases.push(phase);
    } else if (s.icon === '💡') {
      phases.push({ icon: '💡', title: 'LLM 综合分析', subtitle: s.subtitle, status: s.status, childIndices: [i], elapsed_ms: s.elapsed_ms });
      i++;
    } else if (s.icon === '✅') {
      phases.push({ icon: '✅', title: '流程结束', subtitle: s.subtitle, status: s.status, childIndices: [i], elapsed_ms: s.elapsed_ms });
      i++;
    } else {
      phases.push({ icon: s.icon, title: s.title, subtitle: s.subtitle, status: s.status, childIndices: [i], elapsed_ms: s.elapsed_ms });
      i++;
    }
  }
  return phases;
};

App.buildDynamicPipeline = function(steps, isComplete) {
  const flow = document.getElementById('pipeline-flow');
  const statsEl = document.getElementById('pipeline-stats');
  const ld = App.state.lastRunData;

  if (!steps || steps.length === 0) {
    flow.innerHTML = '<div class="pipe-placeholder">发送一条消息后，这里会实时展示 Agent 的完整执行流程 →</div>';
    statsEl.innerHTML = '';
    return;
  }

  const totalMs = ld.totalMs || (steps.length > 0 ? steps[steps.length - 1].elapsed_ms || 0 : 0);
  const llmRounds = steps.filter(s => s.icon === '🧠').length;
  const toolCalls = steps.filter(s => s.icon === '⚙️').length;
  const answerLen = ld.answer ? ld.answer.length : 0;

  let evalTokens = 0, promptTokens = 0;
  steps.forEach(s => {
    if (s.llm_response) {
      if (s.llm_response.eval_count) evalTokens += s.llm_response.eval_count;
      if (s.llm_response.prompt_eval_count) promptTokens += s.llm_response.prompt_eval_count;
    }
  });

  let statsHtml = '';
  if (totalMs) statsHtml += `<span class="stat-chip">⏱ <span class="stat-val">${totalMs}ms</span></span>`;
  if (llmRounds) statsHtml += `<span class="stat-chip">🧠 LLM <span class="stat-val">×${llmRounds}</span></span>`;
  if (toolCalls) statsHtml += `<span class="stat-chip">🔧 工具 <span class="stat-val">×${toolCalls}</span></span>`;
  if (promptTokens || evalTokens) statsHtml += `<span class="stat-chip">📝 tokens <span class="stat-val">${promptTokens + evalTokens}</span></span>`;
  if (answerLen) statsHtml += `<span class="stat-chip">💬 回答 <span class="stat-val">${answerLen}字</span></span>`;
  if (steps.length) statsHtml += `<span class="stat-chip">📊 步骤 <span class="stat-val">${steps.length}</span></span>`;
  statsEl.innerHTML = statsHtml;

  const phases = App.aggregateStepsIntoPhases(steps);

  let html = '';
  phases.forEach((phase, pi) => {
    const statusClass = phase.status === 'done' ? 'done' : phase.status === 'running' ? 'active' : phase.status === 'error' ? 'error-step' : '';
    const arrowStatusClass = phase.status === 'done' ? 'done' : phase.status === 'running' ? 'active' : '';
    const countBadge = phase.childIndices.length > 1 ? `<span class="click-hint">${phase.childIndices.length} 步</span>` : '';
    const timeBadge = phase.elapsed_ms ? `<span class="click-hint">${phase.elapsed_ms}ms</span>` : '<span class="click-hint">点击看详情</span>';
    html += `<div class="pipe-step ${statusClass}" data-phase="${pi}" title="${App.escapeHtml(phase.subtitle || phase.title || '')}">
      <span class="step-icon">${phase.icon || '⬜'}</span>
      <span class="step-num">STEP ${pi + 1}</span>
      ${App.escapeHtml(phase.title || '')}
      ${countBadge}${timeBadge}
    </div>`;
    if (pi < phases.length - 1) {
      html += `<div class="pipe-arrow ${arrowStatusClass}">→</div>`;
    }
  });
  flow.innerHTML = html;
  flow.scrollLeft = flow.scrollWidth;

  const pipeDetailEl = document.getElementById('pipe-detail');
  flow.querySelectorAll('.pipe-step').forEach(el => {
    el.addEventListener('click', () => {
      const pi = +el.dataset.phase;
      if (App.state.currentDetailStep === pi) {
        pipeDetailEl.classList.remove('show');
        App.state.currentDetailStep = -1;
        return;
      }
      App.state.currentDetailStep = pi;
      App.renderPhaseDetail(phases[pi]);
    });
  });
};

App.buildPhaseSummary = function(phase, childSteps) {
  const ld = App.state.lastRunData;

  if (phase.icon === '💬') {
    const msg = childSteps[0]?.user_msg || ld.userMessage || '';
    const preview = msg.length > 60 ? msg.slice(0, 60) + '…' : msg;
    return {
      what: `用户向 Agent 发出了一条请求：<strong>"${App.escapeHtml(preview)}"</strong>（${msg.length} 字）。Agent 将基于此开始整个推理-工具-回答流程。`,
      human: `你刚才问了一句话，Agent 收到了——接下来它会自己决定怎么做。`,
      tags: ['自然语言接口', 'Human-in-the-loop'],
    };
  }

  if (phase.icon === '🧠') {
    const llmStep = childSteps.find(s => s.icon === '🧠');
    return {
      what: `第 <strong>${llmStep?.round || '?'}</strong> 轮 LLM 推理（模型 ${App.escapeHtml(llmStep?.model || '?')}）。将 ${llmStep?.num_messages || '?'} 条对话消息送入模型，LLM 分析后未调用工具，直接进入下一步。`,
      human: `AI 想了想，这轮还不需要动手。`,
      tags: ['LLM 推理', '意图识别'],
    };
  }

  if (phase.icon === '🔧') {
    const llmStep = childSteps.find(s => s.icon === '🧠');
    const decisionStep = childSteps.find(s => s.icon === '🎯');
    const resultSteps = childSteps.filter(s => s.icon === '📊');
    const round = llmStep?.round || '?';
    const model = llmStep?.model || '?';
    const toolNames = decisionStep?.tool_names || [];
    const llmMs = decisionStep?.llm_ms;

    let whatParts = [];
    whatParts.push(`第 <strong>${round}</strong> 轮推理（${App.escapeHtml(model)}）`);
    if (toolNames.length) whatParts.push(`LLM 决定调用 <strong>${toolNames.map(n => toolZh(n)).join('、')}</strong>`);
    resultSteps.forEach(rs => {
      const tr = rs.tool_result;
      const tn = toolZh(rs.tool_name || '?');
      if (!tr || typeof tr !== 'object') return;
      if (tr.count !== undefined) whatParts.push(`${tn}：返回了 <strong>${tr.count}</strong> 张图像`);
      else if (tr.num_keypoints !== undefined) whatParts.push(`${tn}：检出 <strong>${tr.num_keypoints}</strong> 个关键点（${tr.image_size || '?'}）`);
      else if (tr.num_good_matches !== undefined) {
        const v = tr.verdict || '';
        whatParts.push(`${tn}：${tr.total_matches} 对匹配中 <strong>${tr.num_good_matches}</strong> 对高质量（${v ? App.escapeHtml(v) : '平均距离 ' + tr.top_k_avg_distance}）`);
      } else if (tr.rankings) {
        whatParts.push(`${tn}：在 ${tr.rankings.length} 张中最佳匹配为 <strong>${App.escapeHtml(tr.best_match || tr.rankings[0]?.image || '?')}</strong>`);
      } else if (tr.error) {
        whatParts.push(`${tn}：<span style="color:#f85149">失败 — ${App.escapeHtml(tr.error)}</span>`);
      }
    });
    const timePart = llmMs ? `推理耗时 ${llmMs}ms` : '';
    const totalMs = phase.elapsed_ms ? `，总耗时 ${phase.elapsed_ms}ms` : '';
    const humanToolList = toolNames.map(n => toolZh(n)).join('、') || '工具';
    const humanResults = resultSteps.map(rs => {
      const tr = rs.tool_result;
      if (!tr || typeof tr !== 'object') return null;
      if (tr.count !== undefined) return `数据库里有 ${tr.count} 张图`;
      if (tr.num_keypoints !== undefined) return `找到 ${tr.num_keypoints} 个特征点`;
      if (tr.num_good_matches !== undefined) return `${tr.num_good_matches} 对好匹配`;
      if (tr.rankings) return `${tr.rankings.length} 张排名结果`;
      return null;
    }).filter(Boolean);

    return {
      what: whatParts.join('。') + '。' + (timePart ? `（${timePart}${totalMs}）` : ''),
      human: `AI 选了"${humanToolList}"去干活${humanResults.length ? '，结果：' + humanResults.join('；') : ''}。`,
      tags: toolNames.map(n => n.replace('vision_tool_', '')).concat(['Function Calling']),
    };
  }

  if (phase.icon === '💡') {
    const ansLen = childSteps[0]?.answer_len || (ld.answer || '').length;
    const llmMs = childSteps[0]?.llm_ms;
    return {
      what: `LLM 综合所有工具返回的数据，生成了一份 <strong>${ansLen} 字符</strong>的自然语言分析报告${llmMs ? `（推理耗时 ${llmMs}ms）` : ''}。`,
      human: `AI 看完所有报告，用你能听懂的话写了总结。`,
      tags: ['自然语言生成 NLG', 'Agent 闭环'],
    };
  }

  if (phase.icon === '✅') {
    const llmR = ld.steps.filter(s => s.icon === '🧠').length;
    const toolE = ld.steps.filter(s => s.icon === '⚙️').length;
    return {
      what: `Agent 完成了整个闭环，共 <strong>${llmR}</strong> 轮 LLM 推理、<strong>${toolE}</strong> 次工具调用${ld.totalMs ? `，总耗时 <strong>${ld.totalMs}ms</strong>` : ''}。`,
      human: `全部搞定！你问一句话，AI 自动跑完了所有分析。`,
      tags: ['Agent 闭环', 'End-to-End'],
    };
  }

  if (phase.icon === '❌') {
    const detail = childSteps[0]?.detail || '未知错误';
    return {
      what: `执行过程中遇到错误：<strong>${App.escapeHtml(detail.slice(0, 120))}</strong>`,
      human: `出了点状况——检查下面的详情了解原因。`,
      tags: ['Error Handling'],
    };
  }

  return {};
};

App.renderPhaseDetail = function(phase) {
  const ld = App.state.lastRunData;
  const pipeDetailEl = document.getElementById('pipe-detail');
  const childSteps = phase.childIndices.map(i => ld.steps[i]);
  const edu = App.buildPhaseSummary(phase, childSteps);
  App.resetJsonPanelId();

  let bodyHtml = '';
  if (edu.what) bodyHtml += `<div class="detail-section"><div class="detail-label">这一步做了什么？</div>${edu.what}</div>`;
  if (edu.human) bodyHtml += `<div class="detail-section"><div class="detail-label">说人话</div>${edu.human}</div>`;
  if (edu.tags && edu.tags.length) bodyHtml += `<div class="detail-section"><div class="detail-label">涉及的技术概念</div>${edu.tags.map(t => `<span class="detail-tag">${App.escapeHtml(t)}</span>`).join(' ')}</div>`;

  let liveHtml = '<div class="live-data">';
  let hasLiveContent = false;

  if (phase.icon === '💬') {
    const msg = childSteps[0]?.user_msg || ld.userMessage;
    if (msg) {
      liveHtml += `<div class="live-row"><span class="live-label">你刚才问了</span><span class="live-value highlight">"${App.escapeHtml(msg)}"</span></div>`;
      liveHtml += `<div class="live-row"><span class="live-label">字数</span><span class="live-value">${msg.length} 字</span></div>`;
      hasLiveContent = true;
    }
  }

  if (phase.icon === '🔧' || phase.icon === '🧠') {
    const llmStep = childSteps.find(s => s.icon === '🧠');
    if (llmStep) {
      if (llmStep.model) { liveHtml += `<div class="live-row"><span class="live-label">模型</span><span class="live-value">${App.escapeHtml(llmStep.model)}</span></div>`; hasLiveContent = true; }
      if (llmStep.round) { liveHtml += `<div class="live-row"><span class="live-label">LLM 轮次</span><span class="live-value highlight">第 ${llmStep.round} 轮</span></div>`; hasLiveContent = true; }
      if (llmStep.num_messages) { liveHtml += `<div class="live-row"><span class="live-label">消息数</span><span class="live-value">${llmStep.num_messages} 条</span></div>`; hasLiveContent = true; }
    }
    const decisionStep = childSteps.find(s => s.icon === '🎯');
    if (decisionStep) {
      if (decisionStep.tool_names) { liveHtml += `<div class="live-row"><span class="live-label">选择的工具</span><span class="live-value highlight">${decisionStep.tool_names.map(n => App.escapeHtml(n)).join(', ')}</span></div>`; hasLiveContent = true; }
      if (decisionStep.llm_ms) { liveHtml += `<div class="live-row"><span class="live-label">LLM 推理耗时</span><span class="live-value">${decisionStep.llm_ms}ms</span></div>`; hasLiveContent = true; }
    }
    childSteps.filter(s => s.icon === '📊').forEach(rs => {
      const tr = rs.tool_result;
      const name = rs.tool_name || '?';
      if (tr && typeof tr === 'object') {
        liveHtml += `<hr class="live-divider">`;
        liveHtml += `<div class="live-row"><span class="live-label">工具</span><span class="live-value highlight">${App.escapeHtml(name)}</span></div>`;
        if (rs.tool_ms) liveHtml += `<div class="live-row"><span class="live-label">执行耗时</span><span class="live-value">${rs.tool_ms}ms</span></div>`;
        if (tr.num_good_matches !== undefined) {
          liveHtml += `<div class="live-row"><span class="live-label">好匹配数</span><span class="live-value highlight">${tr.num_good_matches} 对</span></div>`;
          if (tr.total_matches !== undefined) liveHtml += `<div class="live-row"><span class="live-label">总匹配数</span><span class="live-value">${tr.total_matches} 对</span></div>`;
          if (tr.top_k_avg_distance !== undefined) liveHtml += `<div class="live-row"><span class="live-label">平均距离</span><span class="live-value">${tr.top_k_avg_distance}</span></div>`;
          if (tr.verdict) {
            const vc = tr.verdict.includes('高度') || tr.verdict.includes('HIGH') || tr.verdict.includes('SAME') ? 'highlight' : tr.verdict.includes('不') || tr.verdict.includes('LOW') || tr.verdict.includes('DIFF') ? 'bad' : 'warn';
            liveHtml += `<div class="live-row"><span class="live-label">算法判定</span><span class="live-value ${vc}">${App.escapeHtml(tr.verdict)}</span></div>`;
          }
        } else if (tr.num_keypoints !== undefined) {
          liveHtml += `<div class="live-row"><span class="live-label">关键点数</span><span class="live-value highlight">${tr.num_keypoints} 个</span></div>`;
          if (tr.image_size) liveHtml += `<div class="live-row"><span class="live-label">图像尺寸</span><span class="live-value">${tr.image_size}</span></div>`;
        } else if (tr.rankings) {
          liveHtml += `<div class="live-row"><span class="live-label">检索结果</span><span class="live-value highlight">${tr.rankings.length} 个候选</span></div>`;
          if (tr.best_match) liveHtml += `<div class="live-row"><span class="live-label">最佳匹配</span><span class="live-value highlight">${App.escapeHtml(tr.best_match)}</span></div>`;
        } else if (tr.count !== undefined) {
          liveHtml += `<div class="live-row"><span class="live-label">图像数量</span><span class="live-value highlight">${tr.count} 张</span></div>`;
        }
        if (tr.error) liveHtml += `<div class="live-row"><span class="live-label">错误</span><span class="live-value bad">${App.escapeHtml(tr.error)}</span></div>`;
        if (rs.has_vis) liveHtml += `<div class="live-row"><span class="live-label">可视化</span><span class="live-value highlight">✓ 已生成匹配连线图</span></div>`;
        hasLiveContent = true;
      }
    });
  }

  if (phase.icon === '💡') {
    const ans = ld.answer || childSteps[0]?.detail;
    if (ans) {
      liveHtml += `<div style="font-size:0.72rem;color:#8b949e;margin-bottom:4px;">LLM 最终给你的回答：</div>`;
      liveHtml += `<div style="font-size:0.8rem;color:#e6edf3;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${App.escapeHtml(ans).slice(0, 800)}${ans.length > 800 ? '…' : ''}</div>`;
      const ansStep = childSteps[0];
      if (ansStep.llm_ms) liveHtml += `<hr class="live-divider"><div class="live-row"><span class="live-label">推理耗时</span><span class="live-value">${ansStep.llm_ms}ms</span></div>`;
      if (ansStep.answer_len) liveHtml += `<div class="live-row"><span class="live-label">回答长度</span><span class="live-value">${ansStep.answer_len} 字符</span></div>`;
      hasLiveContent = true;
    }
  }

  if (phase.icon === '✅') {
    if (ld.totalMs) { liveHtml += `<div class="live-row"><span class="live-label">全程耗时</span><span class="live-value highlight">${ld.totalMs}ms</span></div>`; hasLiveContent = true; }
    const llmR = ld.steps.filter(s => s.icon === '🧠').length;
    const toolE = ld.steps.filter(s => s.icon === '⚙️').length;
    if (llmR) { liveHtml += `<div class="live-row"><span class="live-label">LLM 轮次</span><span class="live-value">${llmR}</span></div>`; hasLiveContent = true; }
    if (toolE) { liveHtml += `<div class="live-row"><span class="live-label">工具执行</span><span class="live-value">${toolE} 次</span></div>`; hasLiveContent = true; }
  }

  if (phase.icon === '❌') {
    const detail = childSteps[0]?.detail;
    if (detail) { liveHtml += `<div class="live-row"><span class="live-label">错误详情</span><span class="live-value bad">${App.escapeHtml(detail)}</span></div>`; hasLiveContent = true; }
  }

  liveHtml += '</div>';
  if (hasLiveContent) bodyHtml += liveHtml;

  childSteps.forEach(s => {
    if (s.llm_request) bodyHtml += App.renderJsonPanel('LLM Request · 发给模型的完整请求', s.llm_request);
    if (s.llm_response) bodyHtml += App.renderJsonPanel('LLM Response · 模型返回', s.llm_response);
    if (s.tool_args !== undefined) bodyHtml += App.renderJsonPanel('Tool Input · 工具参数', s.tool_args);
    if (s.tool_result !== undefined) bodyHtml += App.renderJsonPanel('Tool Output · 工具返回', s.tool_result);
  });

  if (phase.elapsed_ms) {
    bodyHtml += `<div class="detail-section"><div class="live-row"><span class="live-label">耗时</span><span class="live-value">${phase.elapsed_ms}ms</span></div></div>`;
  }

  pipeDetailEl.innerHTML = `
    <div class="pipe-detail-header">
      <span class="pipe-detail-icon">${phase.icon || '⬜'}</span>
      <span class="pipe-detail-title">${App.escapeHtml(phase.title || 'Phase')}</span>
      <button class="pipe-detail-close" id="pipe-detail-close">收起 ✕</button>
    </div>
    <div class="pipe-detail-body">${bodyHtml}</div>`;
  pipeDetailEl.classList.add('show');
  document.getElementById('pipe-detail-close').addEventListener('click', (e) => {
    e.stopPropagation();
    pipeDetailEl.classList.remove('show');
    App.state.currentDetailStep = -1;
  });
};

App.renderDynamicPipeDetail = function(idx) {
  const phases = App.aggregateStepsIntoPhases(App.state.lastRunData.steps);
  if (idx >= phases.length) return;
  App.renderPhaseDetail(phases[idx]);
};

App.setPipelineStep = function(_step) {
  App.buildDynamicPipeline(App.state.lastRunData.steps, false);
};

App.refreshPipeDetailIfOpen = function() {
  if (App.state.currentDetailStep >= 0 && document.getElementById('pipe-detail').classList.contains('show')) {
    App.renderDynamicPipeDetail(App.state.currentDetailStep);
  }
};

App.captureStepData = function(event) {
  const ld = App.state.lastRunData;
  ld.steps.push(event);
  if (event.elapsed_ms) ld.totalMs = event.elapsed_ms;
  if (event.llm_request) ld.llmRequest = event.llm_request;
  if (event.llm_response) ld.llmResponse = event.llm_response;
  if (event.tool_name) ld.toolName = event.tool_name;
  if (event.tool_args !== undefined) ld.toolArgs = event.tool_args;
  if (event.tool_result !== undefined) ld.toolResult = event.tool_result;
};

App.getCurrentPipelineStep = function() {
  return App.state.lastRunData.steps ? App.state.lastRunData.steps.length - 1 : -1;
};
