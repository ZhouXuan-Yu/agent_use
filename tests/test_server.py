"""Backend API tests; LLM calls are mocked via _call_llm."""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import server

_TRANSPORT = httpx.ASGITransport(app=server.app)


@pytest.fixture
async def client():
    async with httpx.AsyncClient(transport=_TRANSPORT, base_url="http://testserver") as c:
        yield c


# ── Static routes ──


async def test_index_ok(client):
    r = await client.get("/")
    assert r.status_code == 200
    assert "LLM" in r.text or "Agent" in r.text


async def test_styles_css_served(client):
    r = await client.get("/styles.css")
    assert r.status_code == 200
    assert "body" in r.text
    assert "margin: 0" in r.text or "box-sizing" in r.text


async def test_js_module_served(client):
    r = await client.get("/js/chat.js")
    assert r.status_code == 200
    assert "App.sendMessage" in r.text


async def test_api_images_returns_entries(client):
    r = await client.get("/api/images")
    assert r.status_code == 200
    data = r.json()
    assert "images" in data and "count" in data
    assert data["count"] >= 1
    assert any("name" in img for img in data["images"])


# ── Vision tool direct test ──


def test_vision_tool_match_images_direct():
    out = server.vision_tool_match_images("city_day.jpg", "city_angle2.jpg", top_k=10)
    assert "error" not in out, out
    assert out["num_keypoints_1"] > 0
    assert out["num_good_matches"] > 0


# ── AI Config endpoints ──


async def test_ai_config_roundtrip(client, tmp_path, monkeypatch):
    cfg_path = tmp_path / "ai_config.json"
    monkeypatch.setattr(server, "AI_CONFIG_PATH", cfg_path)

    r = await client.get("/api/ai-config")
    assert r.status_code == 200
    data = r.json()
    assert data["active_provider"] == "ollama"
    assert "ollama" in data["providers"]

    data["active_provider"] = "deepseek"
    r = await client.post("/api/ai-config", json=data)
    assert r.status_code == 200

    r = await client.get("/api/ai-config")
    assert r.json()["active_provider"] == "deepseek"


# ── Ollama models endpoint (uses real local Ollama or mocked) ──


async def test_ollama_models_endpoint(client):
    """Ollama models endpoint returns proper structure (hit real Ollama or 503)."""
    r = await client.get("/api/ollama-models")
    data = r.json()
    if r.status_code == 200:
        assert "models" in data
        assert "count" in data
        assert isinstance(data["models"], list)
    else:
        assert r.status_code == 503
        assert "error" in data


# ── AI test endpoint ──


async def test_ai_test_ollama(client):
    """Test connection endpoint for Ollama (hits real Ollama or returns error)."""
    r = await client.post(
        "/api/ai-test",
        json={"provider": "ollama", "base_url": "http://localhost:11434", "api_key": "", "model": "qwen3:8b"},
    )
    data = r.json()
    assert "ok" in data or "error" in data


# ── Chat endpoint with mocked LLM ──


async def test_api_chat_direct_answer(client):
    mock_llm = AsyncMock(return_value={"content": "直接回答，无工具", "tool_calls": [], "raw": {}})
    with patch.object(server, "_call_llm", mock_llm):
        r = await client.post("/api/chat", json={"message": "你好", "history": []})
    assert r.status_code == 200
    body = r.text
    assert '"type": "step"' in body
    assert '"type": "answer"' in body
    assert '"type": "done"' in body
    assert "接收用户提问" in body
    assert "LLM 返回最终回答" in body


async def test_api_chat_tool_round(client):
    call_count = 0

    async def _fake_llm(messages, tools, provider_id, provider_cfg):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return {
                "content": "",
                "tool_calls": [{"function": {"name": "list_available_images", "arguments": {}}}],
                "raw": {},
            }
        return {"content": "这是结果", "tool_calls": [], "raw": {}}

    with patch.object(server, "_call_llm", side_effect=_fake_llm):
        r = await client.post("/api/chat", json={"message": "列出图片", "history": []})
    assert r.status_code == 200
    body = r.text
    assert "接收用户提问" in body
    assert "LLM 推理" in body
    assert "LLM 决策：调用工具" in body
    assert "构造工具参数" in body
    assert "执行工具" in body
    assert "工具返回结果" in body
    assert "流程结束" in body
    assert '"type": "done"' in body


# ── Conversation persistence API ──


async def test_conversations_save_list_load_rename_delete(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "CONVERSATIONS_DIR", tmp_path)
    payload = {
        "id": "convtest001",
        "title": "测试标题",
        "chatHistory": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "yo"}],
        "chatMessagesHtml": '<div class="msg"></div>',
    }
    r = await client.post("/api/conversations", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert data["id"] == "convtest001"

    r = await client.get("/api/conversations")
    assert r.status_code == 200
    convos = r.json()["conversations"]
    assert any(c["id"] == "convtest001" for c in convos)
    row = next(c for c in convos if c["id"] == "convtest001")
    assert row["title"] == "测试标题"
    assert row["message_count"] == 2

    r = await client.get("/api/conversations/convtest001")
    assert r.status_code == 200
    loaded = r.json()
    assert loaded["title"] == "测试标题"
    assert len(loaded["chatHistory"]) == 2

    r = await client.patch("/api/conversations/convtest001", json={"title": "改名后"})
    assert r.status_code == 200

    r = await client.get("/api/conversations/convtest001")
    assert r.json()["title"] == "改名后"

    r = await client.delete("/api/conversations/convtest001")
    assert r.status_code == 200

    r = await client.get("/api/conversations/convtest001")
    assert r.status_code == 404


async def test_conversations_post_assigns_id_when_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "CONVERSATIONS_DIR", tmp_path)
    r = await client.post(
        "/api/conversations",
        json={"title": "无 id", "chatHistory": [{"role": "user", "content": "a"}]},
    )
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert len(data["id"]) >= 8


# ── Skills API (LLM-driven; capture uses mock) ──


async def test_api_skills_list_uses_isolated_dir(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SKILLS_DIR", tmp_path)
    r = await client.get("/api/skills")
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 0
    assert data["skills"] == []


async def test_api_skills_create_get_roundtrip(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SKILLS_DIR", tmp_path)
    create_body = {
        "name": "契约测试技能",
        "description": "pytest",
        "keywords": ["契约关键词"],
        "system_prompt_addon": "测试指令：" + "x" * 60,
        "suggested_workflow": [{"tool": "list_available_images", "description": "列出"}],
    }
    r = await client.post("/api/skills", json=create_body)
    assert r.status_code == 200
    skill_id = r.json()["id"]

    r = await client.get("/api/skills")
    assert r.json()["count"] == 1
    row = r.json()["skills"][0]
    assert row["id"] == skill_id
    assert row["has_instructions"] is True

    r = await client.get(f"/api/skills/{skill_id}")
    assert r.status_code == 200
    full = r.json()
    assert full["name"] == "契约测试技能"
    assert len(full["versions"][0].get("system_prompt_addon", "")) > 50


async def test_api_skills_capture_mock_llm(client):
    async def _fake_llm(_steps, _prov, _cfg):
        return "这是一条由 mock 生成的技能指令。" * 5

    with patch.object(server, "_generate_skill_instructions_llm", side_effect=_fake_llm):
        r = await client.post(
            "/api/skills/capture",
            json={
                "steps": [
                    {"tool_name": "list_available_images", "tool_args": {}, "title": "列出"},
                ]
            },
        )
    assert r.status_code == 200
    data = r.json()
    assert data.get("error") is None
    assert data["llm_generated"] is True
    assert len(data["system_prompt_addon"]) > 50
    assert data["tool_count"] == 1


async def test_api_skills_capture_mechanical_fallback(client):
    with patch.object(server, "_generate_skill_instructions_llm", AsyncMock(return_value=None)):
        r = await client.post(
            "/api/skills/capture",
            json={
                "steps": [
                    {"tool_name": "list_available_images", "tool_args": {}, "title": "列出"},
                ]
            },
        )
    assert r.status_code == 200
    data = r.json()
    assert data["llm_generated"] is False
    assert len(data["system_prompt_addon"]) > 20


async def test_api_skills_execute_preview(client, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "SKILLS_DIR", tmp_path)
    skill_id = "testskill_ab12cd"
    skill = {
        "id": skill_id,
        "name": "预览",
        "description": "",
        "keywords": ["k"],
        "versions": [
            {
                "version": 1,
                "created_at": "2026-01-01 00:00:00",
                "author": "user",
                "changelog": "",
                "system_prompt_addon": "addon text",
                "suggested_workflow": [{"tool": "list_available_images", "description": "x"}],
            }
        ],
        "active_version": 1,
        "enabled": True,
        "execution_count": 0,
        "execution_log": [],
        "created_at": "2026-01-01 00:00:00",
        "updated_at": "2026-01-01 00:00:00",
    }
    (tmp_path / f"{skill_id}.json").write_text(json.dumps(skill, ensure_ascii=False), encoding="utf-8")

    r = await client.post(f"/api/skills/{skill_id}/execute", json={})
    assert r.status_code == 200
    data = r.json()
    assert data["system_prompt_addon"] == "addon text"
    assert "LLM-driven" in data.get("hint", "")
