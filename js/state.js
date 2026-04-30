/**
 * state.js — Centralised mutable state shared across modules.
 *
 * Every module reads/writes through App.state so there is a single
 * source of truth and no hidden coupling via closure variables.
 */
'use strict';

window.App = window.App || {};

App.state = {
  imageNames: [],
  selectedImages: [],
  chatHistory: [],
  isSending: false,

  lastRunData: {
    userMessage: null, llmRequest: null, llmResponse: null,
    toolName: null, toolArgs: null, toolResult: null,
    answer: null, totalMs: 0, steps: [],
  },

  currentDetailStep: -1,
  currentDetailTool: null,
  lastCalledTool: null,
  toolCallDataByName: {},

  currentConvId: null,
  currentConvTitle: '新对话',
  savePending: null,

  aiConfig: null,
  ollamaModels: [],
  ollamaAutoRefreshTimer: null,
  aiSettingsLoaded: false,
  providerTestStatus: {},

  skills: [],
  skillsLoaded: false,
  currentSkillDetail: null,
  skillCaptureDraft: null,
  skillsTabView: 'card',
  skillsTabFilter: '',
  skillDiffSelection: { v1: null, v2: null },
};

App.resetLastRunData = function() {
  App.state.lastRunData = {
    userMessage: null, llmRequest: null, llmResponse: null,
    toolName: null, toolArgs: null, toolResult: null,
    answer: null, totalMs: 0, steps: [],
  };
  App.state.currentDetailStep = -1;
};

App.resetToolCallData = function() {
  App.state.lastCalledTool = null;
  App.state.toolCallDataByName = {};
};
