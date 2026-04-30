/**
 * utils.js — Shared utility functions used across all modules.
 */
'use strict';

window.App = window.App || {};

App.escapeHtml = function(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
};

App.formatMarkdown = function(src) {
  const lines = src.split('\n');
  const out = [];
  let i = 0;

  function inline(s) {
    s = App.escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return s;
  }

  while (i < lines.length) {
    const ln = lines[i];

    if (ln.trimStart().startsWith('```')) {
      i++;
      const code = [];
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(App.escapeHtml(lines[i]));
        i++;
      }
      i++;
      out.push('<pre><code>' + code.join('\n') + '</code></pre>');
      continue;
    }

    if (ln.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:\-]+\|[\s:\-|]+$/.test(lines[i + 1])) {
      const parseRow = r => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
      const headers = parseRow(ln);
      i += 2;
      let tbl = '<table><thead><tr>' + headers.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
      while (i < lines.length && lines[i].includes('|')) {
        const cells = parseRow(lines[i]);
        tbl += '<tr>' + cells.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
        i++;
      }
      tbl += '</tbody></table>';
      out.push(tbl);
      continue;
    }

    const hm = ln.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      const lvl = hm[1].length;
      out.push(`<h${lvl}>${inline(hm[2])}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(ln.trim())) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (ln.startsWith('> ')) {
      const bq = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        bq.push(inline(lines[i].slice(2)));
        i++;
      }
      out.push('<blockquote>' + bq.join('<br>') + '</blockquote>');
      continue;
    }

    if (/^[\-\*]\s+/.test(ln)) {
      out.push('<ul>');
      while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) {
        out.push('<li>' + inline(lines[i].replace(/^[\-\*]\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ul>');
      continue;
    }

    if (/^\d+\.\s+/.test(ln)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        out.push('<li>' + inline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
        i++;
      }
      out.push('</ol>');
      continue;
    }

    if (ln.trim() === '') { i++; continue; }

    out.push('<p>' + inline(ln) + '</p>');
    i++;
  }
  return out.join('\n');
};

App.syntaxHighlightJson = function(json) {
  const s = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  return App.escapeHtml(s)
    .replace(/"([^"]+)"(?=\s*:)/g, '<span class="j-key">"$1"</span>')
    .replace(/:\s*"([^"]*?)"/g, ': <span class="j-str">"$1"</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="j-num">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="j-bool">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="j-null">$1</span>');
};

App.formatJsonFull = function(obj) {
  if (!obj) return '';
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return App.escapeHtml(s);
};

App.formatBytes = function(bytes) {
  if (!bytes) return '—';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
  return bytes + ' B';
};

App.sleep = function(ms) { return new Promise(r => setTimeout(r, ms)); };

window.showLightbox = function(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('show');
};
