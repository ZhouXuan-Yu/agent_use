/**
 * image-library.js — Image library panel: load, select, upload.
 */
'use strict';

window.App = window.App || {};

App.loadImages = async function() {
  const libGrid = document.getElementById('lib-grid');
  try {
    const resp = await fetch('/api/images');
    const data = await resp.json();
    libGrid.innerHTML = '';
    App.state.imageNames = data.images.map(img => img.name);
    data.images.forEach(img => {
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.dataset.name = img.name;

      const imgEl = document.createElement('img');
      if (img.thumbnail) {
        imgEl.src = 'data:image/jpeg;base64,' + img.thumbnail;
      } else {
        imgEl.style.background = '#21262d';
        imgEl.alt = img.name;
      }
      card.appendChild(imgEl);

      const nameEl = document.createElement('div');
      nameEl.className = 'lib-name';
      nameEl.textContent = img.name;
      card.appendChild(nameEl);

      const check = document.createElement('div');
      check.className = 'check';
      check.textContent = '✓';
      card.appendChild(check);

      card.addEventListener('click', () => App.toggleSelectImage(card, img.name));
      libGrid.appendChild(card);
    });
  } catch (e) {
    libGrid.innerHTML = '<div style="grid-column:1/-1;color:#f85149;font-size:0.78rem;padding:20px;text-align:center">加载失败 — 请确保 server.py 正在运行</div>';
  }
};

App.toggleSelectImage = function(card, name) {
  const chatInput = document.getElementById('chat-input');
  const sel = App.state.selectedImages;
  card.classList.toggle('selected');
  const idx = sel.indexOf(name);
  if (idx >= 0) sel.splice(idx, 1);
  else sel.push(name);

  const current = chatInput.value;
  if (sel.length === 1) {
    if (!current.includes(sel[0])) {
      chatInput.value = current ? current + ' ' + sel[0] : sel[0];
    }
  } else if (sel.length === 2) {
    chatInput.value = `请比较 ${sel[0]} 和 ${sel[1]} 是否是同一场景`;
  } else if (sel.length > 2) {
    chatInput.value = `请在 ${sel.slice(0, -1).join('、')} 中找到和 ${sel[sel.length - 1]} 最相似的图`;
  }
  chatInput.focus();
};

App.initUpload = function() {
  document.getElementById('file-input').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const resp = await fetch('/api/upload', { method: 'POST', body: form });
        const data = await resp.json();
        if (data.name) {
          App.addSystemMsg(`✅ 已上传: ${data.name}`);
          App.loadImages();
        }
      } catch (err) {
        App.addSystemMsg(`❌ 上传失败: ${err.message}`);
      }
    }
    e.target.value = '';
  });
};
