/**
 * resize.js — Chat panel & toolbox sidebar resize handles.
 */
'use strict';

window.App = window.App || {};

App.initChatResize = function() {
  const STORAGE_KEY = 'demo5_chat_height';
  const handle = document.getElementById('chat-resize-handle');
  const chatMessages = document.getElementById('chat-messages');
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const h = parseInt(saved, 10);
    if (h >= 300) chatMessages.style.height = h + 'px';
  }

  let startY, startH;
  function onMouseMove(e) {
    chatMessages.style.height = Math.max(300, startH + (e.clientY - startY)) + 'px';
  }
  function onMouseUp() {
    handle.classList.remove('active');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    localStorage.setItem(STORAGE_KEY, parseInt(chatMessages.style.height, 10));
  }
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startY = e.clientY;
    startH = chatMessages.offsetHeight;
    handle.classList.add('active');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onTouchMove(e) {
    chatMessages.style.height = Math.max(300, startH + (e.touches[0].clientY - startY)) + 'px';
  }
  function onTouchEnd() {
    handle.classList.remove('active');
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    localStorage.setItem(STORAGE_KEY, parseInt(chatMessages.style.height, 10));
  }
  handle.addEventListener('touchstart', function(e) {
    e.preventDefault();
    startY = e.touches[0].clientY;
    startH = chatMessages.offsetHeight;
    handle.classList.add('active');
    document.addEventListener('touchmove', onTouchMove);
    document.addEventListener('touchend', onTouchEnd);
  }, { passive: false });
};

App.initToolboxResize = function() {
  const handle = document.getElementById('toolbox-resize-handle');
  const panel = document.getElementById('toolbox-panel');
  if (!handle || !panel) return;

  const STORAGE_KEY = 'toolbox-width';
  const DEFAULT_W = 360, MIN_W = 220, MAX_W = 800;
  let startX, startW, dragging = false;

  const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  if (saved >= MIN_W && saved <= MAX_W) panel.style.width = saved + 'px';

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.width = Math.min(MAX_W, Math.max(MIN_W, startW + (startX - e.clientX))) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem(STORAGE_KEY, panel.offsetWidth);
  });
  handle.addEventListener('dblclick', () => {
    panel.style.width = DEFAULT_W + 'px';
    localStorage.setItem(STORAGE_KEY, DEFAULT_W);
  });
};
