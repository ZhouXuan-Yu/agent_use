/**
 * app.js — Bootstrap: wire up all modules and start the application.
 */
'use strict';

(function() {
  // Lightbox close handler
  document.getElementById('lightbox').addEventListener('click', function() {
    this.classList.remove('show');
  });

  // Initialise all modules
  App.initChatResize();
  App.initToolboxResize();
  App.initUpload();
  App.initChatInput();
  App.initToolboxCards();
  App.initTabNavigation();
  App.initConversationUI();
  App.initSkills();

  // Load data
  App.loadImages();
  App.loadAIConfig();
  App.restoreLastSession();
})();
