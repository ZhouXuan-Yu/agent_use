"""Contract tests: HTML/CSS/JS must preserve critical UI structure and behaviour.

After the frontend split (index.html + styles.css + js/*.js), most logic lives in
``js/``. Tests combine ``_index()`` with ``_bundle()`` (all CSS + JS) where needed.
"""

from pathlib import Path


def _root() -> Path:
    return Path(__file__).resolve().parents[1]


def _index() -> str:
    return (_root() / "index.html").read_text(encoding="utf-8")


def _bundle() -> str:
    """Concatenate index, stylesheet, and all JS for substring contracts."""
    root = _root()
    parts = [
        _index(),
        (root / "styles.css").read_text(encoding="utf-8"),
    ]
    for p in sorted((root / "js").glob("*.js")):
        parts.append(p.read_text(encoding="utf-8"))
    return "\n".join(parts)


def test_index_links_stylesheet_and_js_modules():
    html = _index()
    assert 'rel="stylesheet" href="styles.css"' in html
    assert 'src="js/utils.js"' in html
    assert 'src="js/app.js"' in html


def test_index_html_binds_send_button_not_inline_onclick():
    html = _bundle()
    assert 'id="btn-send"' in html
    assert "btnSend.addEventListener" in html
    assert "window.sendMessage = App.sendMessage" in html
    assert 'onclick="sendMessage()"' not in _index()


def test_index_html_send_button_is_type_button():
    assert '<button id="btn-send" type="button">' in _index()


def test_format_markdown_handles_tables():
    html = _bundle()
    assert "parseRow" in html
    assert r"[\s:\-]" in html or r"[-\s:]" in html


def test_format_markdown_handles_headings():
    html = _bundle()
    assert "#{1,4}" in html


def test_bubble_css_has_table_styles():
    html = _bundle()
    assert ".bubble table" in html
    assert ".bubble th" in html
    assert ".bubble td" in html


def test_bubble_css_has_heading_styles():
    html = _bundle()
    assert ".bubble h2" in html
    assert ".bubble h3" in html


# ── Waterfall Trace Contract ──


def test_trace_block_exists():
    html = _bundle()
    assert "createTraceBlock" in html
    assert "trace-block" in html
    assert "trace-header" in html
    assert "trace-steps" in html


def test_step_rendering_function():
    html = _bundle()
    assert "addStepToTrace" in html
    assert "wf-step" in html
    assert "wf-step-head" in html
    assert "wf-step-detail" in html


def test_trace_finalize_function():
    html = _bundle()
    assert "finalizeTrace" in html


def test_trace_css_classes():
    html = _bundle()
    assert ".trace-block" in html
    assert ".wf-step" in html
    assert ".wf-step-badge" in html
    assert ".wf-step-chevron" in html


def test_sendmessage_uses_trace():
    html = _bundle()
    assert "App.createTraceBlock()" in html
    assert "App.addStepToTrace(trace" in html
    assert "App.finalizeTrace(trace" in html


# ── LangSmith-style JSON Panels ──


def test_json_panel_css():
    html = _bundle()
    assert ".json-panel" in html
    assert ".json-panel-head" in html
    assert ".json-panel-body" in html
    assert ".json-panel-label" in html


def test_json_panel_functions():
    html = _bundle()
    assert "makeJsonPanel" in html
    assert "syntaxHighlightJson" in html


def test_json_syntax_classes():
    html = _bundle()
    assert ".j-key" in html
    assert ".j-str" in html
    assert ".j-num" in html
    assert ".j-bool" in html


def test_step_renders_llm_request_response():
    html = _bundle()
    assert "step.llm_request" in html
    assert "step.llm_response" in html
    assert "LLM Request" in html
    assert "LLM Response" in html


def test_step_renders_tool_io():
    html = _bundle()
    assert "step.tool_args" in html
    assert "step.tool_result" in html
    assert "Tool Input" in html
    assert "Tool Output" in html


# ── Tab Navigation ──


def test_tab_navigation_exists():
    html = _index()
    assert "tab-nav" in html
    assert 'data-tab="main"' in html
    assert 'data-tab="skills"' in html
    assert 'data-tab="settings"' in html


def test_tab_content_containers():
    html = _index()
    assert 'id="tab-main"' in html
    assert 'id="tab-skills"' in html
    assert 'id="tab-settings"' in html


# ── AI Settings Tab ──


def test_ai_settings_provider_tabs():
    html = _bundle()
    assert 'id="provider-tabs"' in html
    assert "PROVIDER_META" in html
    assert "renderProviderTabs" in html


def test_ai_settings_providers_list():
    html = _bundle()
    for provider in ["ollama", "deepseek", "kimi", "minimax", "glm"]:
        assert provider in html, f"Provider '{provider}' missing from settings"


def test_ai_settings_config_area():
    html = _bundle()
    assert 'id="provider-config-area"' in html
    assert "renderProviderConfig" in html


def test_ai_settings_ollama_models_section():
    html = _bundle()
    assert 'id="ollama-models-section"' in html
    assert 'id="ollama-models-body"' in html
    assert "loadOllamaModels" in html
    assert "renderOllamaModels" in html


def test_ai_settings_connection_test():
    html = _bundle()
    assert "testConnection" in html
    assert "test-result" in html


def test_ai_settings_persistence():
    html = _bundle()
    assert "loadAIConfig" in html
    assert "saveAIConfig" in html
    assert "/api/ai-config" in html


def test_ai_settings_ollama_auto_refresh():
    html = _bundle()
    assert "startOllamaAutoRefresh" in html
    assert "stopOllamaAutoRefresh" in html
    assert 'id="chk-auto-refresh"' in html


def test_current_ai_badge_in_header():
    html = _bundle()
    assert 'id="current-ai-badge"' in html
    assert "updateAIBadge" in html


# ── Architecture Flow pipeline ──


def test_pipeline_flow_markup():
    html = _bundle()
    assert 'id="pipeline-flow"' in html
    assert 'id="pipeline-stats"' in html
    assert "buildDynamicPipeline" in html
    assert "renderDynamicPipeDetail" in html
    assert ".pipe-step" in html
    assert "pipe-placeholder" in html
    assert 'id="pipe-detail"' in html


def test_pipeline_live_data_state_and_render():
    html = _bundle()
    assert "lastRunData" in html
    assert "resetLastRunData" in html
    assert "captureStepData" in html
    assert "renderDynamicPipeDetail" in html
    assert "refreshPipeDetailIfOpen" in html


def test_pipeline_live_data_css():
    html = _bundle()
    assert ".live-data" in html
    assert "本次操作实况" in html


def test_sendmessage_resets_and_refreshes_pipeline_detail():
    html = _bundle()
    assert "App.resetLastRunData();" in html
    assert "App.state.lastRunData.userMessage = text" in html
    assert "App.captureStepData(event)" in html
    assert "App.refreshPipeDetailIfOpen()" in html


# ── Toolbox ──


def test_toolbox_per_tool_call_state_map():
    html = _bundle()
    assert "toolCallDataByName" in html
    assert "App.captureToolCallData" in html
    assert "App.resetToolCallData" in html


def test_build_tool_live_html_uses_per_tool_map():
    html = _bundle()
    assert "App.buildToolLiveHtml" in html
    assert "App.state.toolCallDataByName[toolName]" in html


def test_sendmessage_resets_tool_call_data_with_highlights():
    html = _bundle()
    assert "App.resetToolCallData();" in html
    assert "App.clearToolHighlights();" in html
    idx = html.find("App.resetToolCallData();")
    assert idx != -1
    assert html.find("App.clearToolHighlights();", idx) > idx


def test_highlight_tool_card_does_not_strip_other_tools():
    """Regression: highlight must add class only; clearing is sendMessage + clearToolHighlights."""
    js = (_root() / "js" / "toolbox.js").read_text(encoding="utf-8")
    start = js.find("App.highlightToolCard = function")
    assert start != -1
    end = js.find("App.clearToolHighlights = function", start)
    assert end != -1
    block = js[start:end]
    assert "querySelectorAll('.tool-card')" not in block
    assert "classList.remove('tool-just-called')" not in block


# ── Conversation persistence ──


def test_conv_bar_and_history_drawer():
    html = _index()
    assert 'id="conv-bar"' in html
    assert 'id="btn-new-conv"' in html
    assert 'id="btn-history-conv"' in html
    assert 'id="conv-title-display"' in html
    assert 'id="conv-drawer-overlay"' in html
    assert 'id="conv-drawer-list"' in html


def test_conversation_serialization_and_beacon_save():
    html = _bundle()
    assert "function serializeFullState" in html
    assert "App.restoreFullState = function" in html
    assert "App.beaconSave = function" in html
    assert "navigator.sendBeacon" in html
    assert "/api/conversations" in html


def test_sendmessage_calls_beacon_save():
    html = _bundle()
    assert "App.beaconSave();" in html
    assert "await App.doSave()" in html


def test_no_legacy_arch_diagram():
    html = _bundle()
    assert "arch-diagram" not in html
    assert 'id="arch-llm"' not in html


def test_no_static_tool_code_panel():
    html = _bundle()
    assert "code-panel" not in html
    assert "Registered Vision Tools" not in html
    assert 'id="code-display"' not in html


def test_chat_resize_handle_and_persistence():
    html = _bundle()
    assert 'id="chat-resize-handle"' in html
    assert "chat-resize-handle" in html
    assert "demo5_chat_height" in html
    assert "App.initChatResize" in html
    assert "localStorage.setItem" in html


# ── Skills (LLM-driven) ──


def test_skills_modules_loaded():
    html = _index()
    assert 'src="js/skills.js"' in html
    assert 'src="js/skill-editor.js"' in html


def test_skills_capture_modal_and_save_trace_button():
    html = _bundle()
    assert 'id="capture-modal-body"' in html
    assert "injectSaveSkillBtn" in html
    assert "trace-save-skill-btn" in html


def test_skills_api_referenced_in_frontend():
    html = _bundle()
    assert "/api/skills" in html
