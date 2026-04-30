/**
 * json-panels.js — Reusable JSON rendering helpers for pipeline detail & trace.
 */
'use strict';

window.App = window.App || {};

let _jsonPanelId = 0;

App.resetJsonPanelId = function() { _jsonPanelId = 0; };

App.renderJsonValue = function(v) {
  if (v === null) return '<span class="val-null">null</span>';
  if (typeof v === 'boolean') return `<span class="val-bool">${v}</span>`;
  if (typeof v === 'number') return `<span class="val-num">${v}</span>`;
  if (typeof v === 'string') {
    const display = v.length > 200 ? v.slice(0, 200) + '…' : v;
    return `<span class="val-str">${App.escapeHtml(display)}</span>`;
  }
  if (Array.isArray(v)) return `<span class="val-arr">[${v.length} items]</span>`;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    const preview = keys.slice(0, 3).map(k => `${k}: ${App.renderJsonValueShort(v[k])}`).join(', ');
    return `<span class="val-obj">{${App.escapeHtml(preview)}${keys.length > 3 ? ', …' : ''}}</span>`;
  }
  return App.escapeHtml(String(v));
};

App.renderJsonValueShort = function(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.length > 30 ? `"${v.slice(0, 30)}…"` : `"${v}"`;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return `{${Object.keys(v).length} keys}`;
  return String(v);
};

App.renderJsonPanel = function(label, data) {
  if (data === undefined || data === null) return '';
  const id = `jp-${++_jsonPanelId}`;
  const obj = typeof data === 'object' ? data : null;
  let structuredHtml = '';

  if (obj && !Array.isArray(obj)) {
    structuredHtml = '<div class="json-panel-structured"><table>';
    for (const [k, v] of Object.entries(obj)) {
      structuredHtml += `<tr><td class="key-col">${App.escapeHtml(k)}</td><td class="val-col">${App.renderJsonValue(v)}</td></tr>`;
    }
    structuredHtml += '</table></div>';
  } else if (Array.isArray(obj)) {
    structuredHtml = '<div class="json-panel-structured"><table>';
    obj.forEach((item, idx) => {
      if (typeof item === 'object' && item !== null) {
        const summary = Object.keys(item).slice(0, 3).map(k => `${k}: ${App.renderJsonValueShort(item[k])}`).join(', ');
        structuredHtml += `<tr><td class="key-col">[${idx}]</td><td class="val-col"><span class="val-obj">${App.escapeHtml(summary)}${Object.keys(item).length > 3 ? ' …' : ''}</span></td></tr>`;
      } else {
        structuredHtml += `<tr><td class="key-col">[${idx}]</td><td class="val-col">${App.renderJsonValue(item)}</td></tr>`;
      }
    });
    structuredHtml += '</table></div>';
  }

  const rawJson = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return `<div class="json-panel-wrap">
    <div class="detail-label">${label}</div>
    ${structuredHtml}
    <button class="json-fold-toggle" onclick="document.getElementById('${id}').classList.toggle('open'); this.textContent = document.getElementById('${id}').classList.contains('open') ? '收起 Raw JSON ▲' : '展开 Raw JSON ▼';">展开 Raw JSON ▼</button>
    <div class="json-fold-raw live-json" id="${id}">${App.escapeHtml(rawJson)}</div>
  </div>`;
};

App.makeJsonPanel = function(label, labelClass, data) {
  const jsonStr = JSON.stringify(data, null, 2);
  const sizeKb = (new Blob([jsonStr]).size / 1024).toFixed(1);
  const panel = document.createElement('div');
  panel.className = 'json-panel';
  panel.innerHTML = `
    <div class="json-panel-head">
      <span class="json-panel-chevron">▶</span>
      <span class="json-panel-label ${labelClass}">${App.escapeHtml(label)}</span>
      <span class="json-panel-size">${sizeKb} KB</span>
    </div>
    <div class="json-panel-body"><pre>${App.syntaxHighlightJson(jsonStr)}</pre></div>`;
  panel.querySelector('.json-panel-head').addEventListener('click', function(e) {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  return panel;
};
