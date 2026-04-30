"""
Demo 5 — LLM Tool Calling × 传统视觉算法
FastAPI backend: Ollama (qwen3.5:35b) + ORB vision tools

启动: python server.py
访问: http://localhost:8765
"""

import base64
import difflib
import json
import os
import re
import time
import traceback
import uuid
from pathlib import Path
from typing import Optional

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

BASE_DIR = Path(__file__).parent
IMAGES_DIR = BASE_DIR / "test_images"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
CONVERSATIONS_DIR = BASE_DIR / "conversations"
CONVERSATIONS_DIR.mkdir(exist_ok=True)
SKILLS_DIR = BASE_DIR / "skills"
SKILLS_DIR.mkdir(exist_ok=True)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen3.5:4b")
AI_CONFIG_PATH = BASE_DIR / "ai_config.json"

PROVIDER_DEFAULTS = {
    "ollama": {
        "name": "Ollama",
        "base_url": "http://localhost:11434",
        "api_key": "",
        "model": "qwen3.5:4b",
        "needs_key": False,
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "api_key": "sk-69633ce4e2534e1bbd93a608b97b962b",
        "model": "deepseek-chat",
        "needs_key": True,
    },
    "kimi": {
        "name": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.cn/v1",
        "api_key": "",
        "model": "moonshot-v1-8k",
        "needs_key": True,
    },
    "minimax": {
        "name": "MiniMax",
        "base_url": "https://api.minimax.chat/v1",
        "api_key": "",
        "model": "MiniMax-Text-01",
        "needs_key": True,
    },
    "glm": {
        "name": "GLM (Zhipu)",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "api_key": "",
        "model": "glm-4-flash",
        "needs_key": True,
    },
}


def load_ai_config() -> dict:
    if AI_CONFIG_PATH.exists():
        try:
            return json.loads(AI_CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"active_provider": "ollama", "providers": {k: {**v} for k, v in PROVIDER_DEFAULTS.items()}}


def save_ai_config(config: dict):
    AI_CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


# ─── Vision Tools ───────────────────────────────────────────────────────


def _load_gray(path: str) -> Optional[np.ndarray]:
    if isinstance(path, Path):
        path = str(path)
    img = _cv2_imread_gray(path)
    if img is None:
        return None
    h, w = img.shape[:2]
    max_dim = 800
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale)
    return img


def _load_color(path: str) -> Optional[np.ndarray]:
    if isinstance(path, Path):
        path = str(path)
    img = _cv2_imread_color(path)
    if img is None:
        return None
    h, w = img.shape[:2]
    max_dim = 800
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, None, fx=scale, fy=scale)
    return img


def _cv2_imread_color(path: str) -> Optional[np.ndarray]:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is not None:
        return img
    try:
        data = np.fromfile(path, dtype=np.uint8)
        if data.size == 0:
            return None
        img = cv2.imdecode(data, cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None


def _cv2_imread_gray(path: str) -> Optional[np.ndarray]:
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is not None:
        return img
    try:
        data = np.fromfile(path, dtype=np.uint8)
        if data.size == 0:
            return None
        img = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
        return img
    except Exception:
        return None


def _cv2_imwrite(path: str, img: np.ndarray) -> bool:
    ok = cv2.imwrite(path, img)
    if not ok:
        try:
            ext = Path(path).suffix.lower()
            if ext in {".jpg", ".jpeg"}:
                _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
            else:
                _, buf = cv2.imencode(ext, img)
            if buf is not None:
                buf.tofile(path)
                return True
        except Exception:
            pass
    return ok


def _img_to_base64(img_bgr: np.ndarray, quality: int = 85) -> str:
    _, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf).decode()


def _resolve_image_path(name: str) -> Optional[str]:
    """Resolve image name to full path, checking direct paths then test_images/ and uploads/."""
    direct = Path(name)
    if direct.is_absolute() and direct.exists():
        return str(direct)
    if not direct.is_absolute() and direct.exists():
        return str(direct.resolve())
    for directory in [IMAGES_DIR, UPLOAD_DIR]:
        candidate = directory / name
        if candidate.exists():
            return str(candidate)
    for directory in [IMAGES_DIR, UPLOAD_DIR]:
        for f in directory.iterdir():
            if f.stem == Path(name).stem:
                return str(f)
    return None


def vision_tool_detect_keypoints(image_name: str) -> dict:
    """Detect ORB keypoints in a single image and return visualization."""
    path = _resolve_image_path(image_name)
    if not path:
        return {"error": f"Image '{image_name}' not found"}

    gray = _load_gray(path)
    color = _load_color(path)
    if gray is None:
        return {"error": f"Failed to load image '{image_name}'"}

    orb = cv2.ORB_create(500)
    kps, des = orb.detectAndCompute(gray, None)

    vis = cv2.drawKeypoints(color, kps, None, color=(0, 255, 0), flags=cv2.DRAW_MATCHES_FLAGS_DRAW_RICH_KEYPOINTS)
    b64 = _img_to_base64(vis)

    return {
        "image_name": image_name,
        "num_keypoints": len(kps),
        "image_size": f"{gray.shape[1]}x{gray.shape[0]}",
        "descriptor_shape": f"{des.shape[0]}x{des.shape[1]}" if des is not None else "N/A",
        "visualization_base64": b64,
    }


def vision_tool_match_images(image_name_1: str, image_name_2: str, top_k: int = 30) -> dict:
    """Match ORB features between two images, return scores and visualization."""
    path1 = _resolve_image_path(image_name_1)
    path2 = _resolve_image_path(image_name_2)
    if not path1:
        return {"error": f"Image '{image_name_1}' not found"}
    if not path2:
        return {"error": f"Image '{image_name_2}' not found"}

    gray1 = _load_gray(path1)
    gray2 = _load_gray(path2)
    color1 = _load_color(path1)
    color2 = _load_color(path2)
    if gray1 is None or gray2 is None:
        return {"error": "Failed to load one or both images"}

    orb = cv2.ORB_create(500)
    kp1, d1 = orb.detectAndCompute(gray1, None)
    kp2, d2 = orb.detectAndCompute(gray2, None)

    if d1 is None or d2 is None:
        return {
            "image_1": image_name_1,
            "image_2": image_name_2,
            "num_keypoints_1": len(kp1) if kp1 else 0,
            "num_keypoints_2": len(kp2) if kp2 else 0,
            "num_good_matches": 0,
            "avg_distance": 999,
            "verdict": "无法匹配 — 至少一张图未检测到描述子",
        }

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(bf.match(d1, d2), key=lambda m: m.distance)
    top_matches = matches[:top_k]

    good = [m for m in matches if m.distance < 50]
    avg_dist = sum(m.distance for m in top_matches) / max(len(top_matches), 1)

    if len(good) > 15:
        verdict = "高度匹配 — 很可能是同一场景/物体"
    elif len(good) > 8:
        verdict = "中度匹配 — 可能是同一场景的不同视角"
    elif len(good) > 3:
        verdict = "低度匹配 — 可能有部分相似内容"
    else:
        verdict = "几乎不匹配 — 大概率是不同场景"

    vis = cv2.drawMatches(
        color1,
        kp1,
        color2,
        kp2,
        top_matches,
        None,
        matchColor=(0, 255, 128),
        singlePointColor=(255, 0, 0),
        flags=cv2.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS,
    )
    b64 = _img_to_base64(vis)

    match_details = [
        {
            "distance": m.distance,
            "kp1_pos": [round(kp1[m.queryIdx].pt[0], 1), round(kp1[m.queryIdx].pt[1], 1)],
            "kp2_pos": [round(kp2[m.trainIdx].pt[0], 1), round(kp2[m.trainIdx].pt[1], 1)],
        }
        for m in top_matches[:10]
    ]

    return {
        "image_1": image_name_1,
        "image_2": image_name_2,
        "num_keypoints_1": len(kp1),
        "num_keypoints_2": len(kp2),
        "total_matches": len(matches),
        "num_good_matches": len(good),
        "top_k_avg_distance": round(avg_dist, 2),
        "verdict": verdict,
        "match_details_top10": match_details,
        "visualization_base64": b64,
    }


def vision_tool_compare_multiple(image_names: list[str], query_image: str) -> dict:
    """Compare a query image against multiple database images, rank by similarity."""
    query_path = _resolve_image_path(query_image)
    if not query_path:
        return {"error": f"Query image '{query_image}' not found"}

    gray_q = _load_gray(query_path)
    if gray_q is None:
        return {"error": f"Failed to load query image '{query_image}'"}

    orb = cv2.ORB_create(500)
    kp_q, d_q = orb.detectAndCompute(gray_q, None)

    if d_q is None:
        return {"error": "Failed to extract descriptors from query image"}

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    results = []
    for name in image_names:
        path = _resolve_image_path(name)
        if not path:
            results.append({"image": name, "error": "not found"})
            continue
        gray = _load_gray(path)
        if gray is None:
            results.append({"image": name, "error": "load failed"})
            continue
        _, d = orb.detectAndCompute(gray, None)
        if d is None:
            results.append({"image": name, "good_matches": 0, "avg_distance": 999})
            continue
        matches = sorted(bf.match(d_q, d), key=lambda m: m.distance)
        good = [m for m in matches if m.distance < 50]
        avg_d = sum(m.distance for m in matches[:20]) / max(len(matches[:20]), 1)
        results.append(
            {
                "image": name,
                "good_matches": len(good),
                "total_matches": len(matches),
                "avg_distance": round(avg_d, 2),
            }
        )

    results.sort(key=lambda r: r.get("good_matches", 0), reverse=True)
    best = results[0] if results else None
    return {
        "query_image": query_image,
        "rankings": results,
        "best_match": best["image"] if best and best.get("good_matches", 0) > 0 else "无明确匹配",
    }


def list_available_images() -> dict:
    """List all available test images."""
    images = []
    for d in [IMAGES_DIR, UPLOAD_DIR]:
        if d.exists():
            for f in sorted(d.iterdir()):
                if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
                    images.append({"name": f.name, "source": d.name})
    return {"images": images, "count": len(images)}


# ─── Tool Registry ───────────────────────────────────────────────────────

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "vision_tool_detect_keypoints",
            "description": "检测单张图像的 ORB 关键点，返回关键点数量及可视化图。用于分析图像中有多少可识别的特征点。",
            "parameters": {
                "type": "object",
                "properties": {"image_name": {"type": "string", "description": "图像文件名，例如 'scene_a.jpg'"}},
                "required": ["image_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "vision_tool_match_images",
            "description": "使用 ORB 特征匹配两张图像，返回匹配数量、平均距离、匹配判定及可视化结果。用于判断两张图是否是同一场景。",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_name_1": {"type": "string", "description": "第一张图像文件名"},
                    "image_name_2": {"type": "string", "description": "第二张图像文件名"},
                    "top_k": {"type": "integer", "description": "取前 top_k 个最佳匹配（默认 30）", "default": 30},
                },
                "required": ["image_name_1", "image_name_2"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "vision_tool_compare_multiple",
            "description": "将一张查询图与多张数据库图像进行 ORB 特征匹配并排名，用于图像检索。",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "数据库图像文件名列表",
                    },
                    "query_image": {"type": "string", "description": "查询图像文件名"},
                },
                "required": ["image_names", "query_image"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_available_images",
            "description": "列出所有可用的测试图像，返回文件名列表。在不确定有哪些图像时调用。",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

TOOL_FUNCTIONS = {
    "vision_tool_detect_keypoints": vision_tool_detect_keypoints,
    "vision_tool_match_images": vision_tool_match_images,
    "vision_tool_compare_multiple": vision_tool_compare_multiple,
    "list_available_images": list_available_images,
}

SYSTEM_PROMPT = """你是一个视觉分析 Agent。你可以调用以下工具来完成视觉任务：

1. **list_available_images** — 查看有哪些可用的测试图像
2. **vision_tool_detect_keypoints** — 对单张图像进行 ORB 关键点检测
3. **vision_tool_match_images** — 比较两张图像的 ORB 特征匹配度
4. **vision_tool_compare_multiple** — 将一张图与多张图进行匹配排名

你的工作流程：
- 当用户问到图像分析问题时，**必须调用工具**获取真实数据，不要凭空编造结果
- 先调用 list_available_images 了解有哪些图可用（如果用户没有明确指定）
- 根据用户需求选择合适的工具
- 基于工具返回的数据给出专业、清晰的分析

回答风格：
- 用中文回答，简洁但专业
- 引用具体的数值数据（关键点数量、匹配数、距离）
- 给出明确的结论

注意：/no_think"""

# ─── API Routes ──────────────────────────────────────────────────────────


@app.get("/", response_class=HTMLResponse)
async def index():
    html_path = BASE_DIR / "index.html"
    return html_path.read_text(encoding="utf-8")


@app.get("/styles.css")
async def styles_css():
    return FileResponse(BASE_DIR / "styles.css", media_type="text/css")


@app.get("/api/images")
async def api_list_images():
    result = list_available_images()
    enriched = []
    for img in result["images"]:
        path = _resolve_image_path(img["name"])
        if path:
            color = _load_color(path)
            if color is not None:
                thumb = cv2.resize(color, (160, 120))
                enriched.append({**img, "thumbnail": _img_to_base64(thumb, 70)})
            else:
                enriched.append(img)
        else:
            enriched.append(img)
    return {"images": enriched, "count": len(enriched)}


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
        return JSONResponse({"error": "Unsupported format"}, status_code=400)
    safe_name = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    dest = UPLOAD_DIR / safe_name
    content = await file.read()
    dest.write_bytes(content)
    return {"name": safe_name, "message": "Upload successful"}


TOOL_DESCRIPTIONS = {
    "vision_tool_detect_keypoints": {
        "zh": "检测关键点",
        "en": "detect_keypoints",
        "detail": "使用 ORB 算法提取图像特征点（Oriented FAST + Rotated BRIEF）",
    },
    "vision_tool_match_images": {
        "zh": "匹配图像",
        "en": "match_images",
        "detail": "使用 BFMatcher + ORB 描述子进行暴力匹配并按距离排序",
    },
    "vision_tool_compare_multiple": {
        "zh": "批量比较",
        "en": "compare_multiple",
        "detail": "对查询图逐一与数据库图像进行 ORB 匹配，按匹配数排名",
    },
    "list_available_images": {
        "zh": "列出图像",
        "en": "list_images",
        "detail": "遍历 test_images/ 和 uploads/ 目录，返回可用图像文件名列表",
    },
}


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def _call_llm(messages, tools_schema, provider_id, provider_cfg):
    """Unified LLM call — dispatches to Ollama native or OpenAI-compatible API."""
    model = provider_cfg.get("model", "")
    base_url = provider_cfg.get("base_url", "")
    api_key = provider_cfg.get("api_key", "")

    if provider_id == "ollama":
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 2048},
        }
        if tools_schema:
            payload["tools"] = tools_schema
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{base_url}/api/chat", json=payload)

            # Some Ollama models don't support tool calling — fall back gracefully
            if resp.status_code == 400:
                err_body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                if "does not support tools" in err_body.get("error", ""):
                    payload.pop("tools", None)
                    # Inject tool descriptions into system prompt so model is aware
                    tool_desc = "\n".join(
                        f"- {t['function']['name']}: {t['function']['description']}" for t in tools_schema
                    )
                    fallback_note = (
                        "\n\n[系统提示] 当前模型不支持 function calling。"
                        "你无法直接调用工具，请根据已有知识回答用户问题。\n"
                        f"可用工具（仅供参考）：\n{tool_desc}"
                    )
                    for m in payload["messages"]:
                        if m["role"] == "system":
                            m["content"] += fallback_note
                            break
                    resp = await client.post(f"{base_url}/api/chat", json=payload)

            resp.raise_for_status()
            data = resp.json()
        msg = data.get("message", {})
        return {
            "content": msg.get("content", ""),
            "tool_calls": msg.get("tool_calls", []),
            "raw": data,
        }
    else:
        openai_tools = []
        for t in tools_schema:
            openai_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": t["function"]["name"],
                        "description": t["function"]["description"],
                        "parameters": t["function"]["parameters"],
                    },
                }
            )
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 2048,
            "stream": False,
        }
        if openai_tools:
            payload["tools"] = openai_tools
        if provider_id == "minimax":
            payload["tokens_to_generate"] = 2048
            payload.pop("max_tokens", None)

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        chat_url = f"{base_url}/chat/completions"
        if provider_id == "minimax":
            chat_url = f"{base_url}/text/chatcompletion_v2"

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(chat_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        choice = data.get("choices", [{}])[0]
        msg = choice.get("message", {})
        content = msg.get("content", "") or ""

        tool_calls_raw = msg.get("tool_calls", [])
        tool_calls = []
        for tc in tool_calls_raw:
            fn = tc.get("function", {})
            args = fn.get("arguments", "{}")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}
            tool_calls.append(
                {
                    "function": {"name": fn.get("name", ""), "arguments": args},
                }
            )
        return {"content": content, "tool_calls": tool_calls, "raw": data}


def _match_skill(user_msg: str) -> tuple[Optional[dict], Optional[dict], str]:
    """Check if user_msg starts with a skill keyword.
    Returns (skill, active_version_obj, remainder_text) or (None, None, "").
    The remainder is the raw user text after the keyword — passed as-is to the LLM."""
    skills = _load_all_skills()
    for skill in skills:
        if not skill.get("enabled", True):
            continue
        for kw in skill.get("keywords", []):
            if not kw:
                continue
            if user_msg.strip().lower().startswith(kw.lower()):
                remainder = user_msg.strip()[len(kw) :].strip().strip(",").strip()
                active_ver = skill.get("active_version", 1)
                version = None
                for v in skill.get("versions", []):
                    if v["version"] == active_ver:
                        version = v
                        break
                if version:
                    return skill, version, remainder
    return None, None, ""


@app.post("/api/chat")
async def api_chat(request: Request):
    body = await request.json()
    user_msg = body.get("message", "")
    history = body.get("history", [])

    ai_config = load_ai_config()
    active_provider = ai_config.get("active_provider", "ollama")
    provider_cfg = ai_config.get("providers", {}).get(active_provider, PROVIDER_DEFAULTS.get(active_provider, {}))
    current_model = provider_cfg.get("model", MODEL_NAME)
    provider_name = provider_cfg.get("name", active_provider)

    matched_skill, matched_version, skill_remainder = _match_skill(user_msg)

    # Build system prompt — augmented with skill instructions when a skill matches
    system_prompt = SYSTEM_PROMPT
    if matched_skill and matched_version:
        addon = matched_version.get("system_prompt_addon", "")
        if addon:
            system_prompt += (
                f"\n\n=== MANDATORY SKILL INSTRUCTIONS: {matched_skill.get('name', '')} ===\n"
                f"The user has activated a registered skill. You MUST follow the instructions below exactly.\n"
                f"Do NOT skip any step. Do NOT optimize away any tool call. Execute ALL steps in order.\n\n"
                f"{addon}\n"
                f"=== END SKILL INSTRUCTIONS ==="
            )

    messages = [{"role": "system", "content": system_prompt}]
    for h in history[-10:]:
        messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_msg})

    async def event_stream():
        nonlocal messages
        max_rounds = 5
        round_num = 0
        t_start = time.time()
        step_idx = 0

        def _step(icon, title, subtitle, detail, status="running", extra=None):
            nonlocal step_idx
            evt = {
                "type": "step",
                "idx": step_idx,
                "icon": icon,
                "title": title,
                "subtitle": subtitle,
                "detail": detail,
                "status": status,
                "elapsed_ms": round((time.time() - t_start) * 1000),
            }
            if extra:
                evt.update(extra)
            step_idx += 1
            return _sse(evt)

        yield _step(
            "📨", "接收用户提问", "User Query", f"用户输入：{user_msg}", status="done", extra={"user_msg": user_msg}
        )

        # ── Skill matched: notify frontend, then fall through to the normal agentic loop ──
        if matched_skill and matched_version:
            skill_name = matched_skill.get("name", matched_skill["id"])
            addon = matched_version.get("system_prompt_addon", "")
            yield _sse(
                {
                    "type": "skill_execution",
                    "skill_id": matched_skill["id"],
                    "skill_name": skill_name,
                    "version": matched_version["version"],
                    "params": {"context": skill_remainder},
                }
            )
            yield _step(
                "⚡",
                f"技能激活：{skill_name}",
                f"Skill v{matched_version['version']} — LLM-driven",
                f"关键词匹配成功，激活技能「{skill_name}」v{matched_version['version']}\n"
                f"技能指令已注入系统提示，LLM 将自主决定工具调用。\n"
                f"用户上下文：{skill_remainder or '(无额外参数)'}",
                status="done",
                extra={"skill_id": matched_skill["id"], "skill_name": skill_name, "skill_addon_len": len(addon)},
            )

        while round_num < max_rounds:
            round_num += 1

            msgs_display = []
            for m in messages:
                mc = {**m}
                if mc.get("role") == "system" and len(mc.get("content", "")) > 200:
                    mc["content"] = mc["content"][:200] + "…(truncated)"
                if "tool_calls" in mc:
                    mc["tool_calls"] = [
                        {"function": {"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]}}
                        for tc in mc["tool_calls"]
                    ]
                msgs_display.append(mc)

            tools_display = [
                {
                    "type": t["type"],
                    "function": {
                        "name": t["function"]["name"],
                        "description": t["function"]["description"][:60] + "…",
                        "parameters": t["function"]["parameters"],
                    },
                }
                for t in TOOLS_SCHEMA
            ]

            yield _step(
                "🧠",
                f"LLM 推理（第 {round_num} 轮）",
                f"Round {round_num} — {provider_name} / {current_model}",
                f"将 {len(messages)} 条消息（含系统提示、历史对话）和 {len(TOOLS_SCHEMA)} 个工具定义发送给 LLM。\n"
                f"供应商：{provider_name}，模型：{current_model}，温度：0.3",
                status="running",
                extra={
                    "round": round_num,
                    "num_messages": len(messages),
                    "num_tools": len(TOOLS_SCHEMA),
                    "model": current_model,
                    "llm_request": {
                        "model": current_model,
                        "messages": msgs_display,
                        "tools": tools_display,
                        "options": {"temperature": 0.3, "num_predict": 2048},
                    },
                },
            )

            t_llm = time.time()
            try:
                llm_result = await _call_llm(messages, TOOLS_SCHEMA, active_provider, provider_cfg)
            except Exception as e:
                yield _step(
                    "❌",
                    "LLM 请求失败",
                    f"{provider_name} Error",
                    f"错误信息：{str(e)}\n请确认 {provider_name} 服务正常且 API Key 有效。",
                    status="error",
                )
                yield _sse({"type": "error", "content": f"{provider_name} 请求失败: {str(e)}"})
                break

            llm_ms = round((time.time() - t_llm) * 1000)
            content = llm_result.get("content", "")
            tool_calls = llm_result.get("tool_calls", [])
            data = llm_result.get("raw", {})
            msg = {"role": "assistant", "content": content}
            if tool_calls:
                msg["tool_calls"] = tool_calls

            if content:
                content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                msg["content"] = content

            llm_resp_display = {
                "message": {
                    "role": "assistant",
                    "content": content[:500] + ("…" if len(content) > 500 else ""),
                    "tool_calls": [
                        {"function": {"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]}}
                        for tc in tool_calls
                    ]
                    if tool_calls
                    else [],
                },
            }
            for k in ("eval_count", "eval_duration", "prompt_eval_count", "prompt_eval_duration", "total_duration"):
                if k in data:
                    llm_resp_display[k] = data[k]

            # LLM decides: tool call vs direct answer
            if not tool_calls:
                yield _step(
                    "💡",
                    "LLM 返回最终回答",
                    f"Direct Answer — {llm_ms}ms",
                    f"LLM 推理耗时 {llm_ms}ms。\n模型选择直接回答，未调用工具。\n回答长度：{len(content)} 字符",
                    status="done",
                    extra={"llm_ms": llm_ms, "answer_len": len(content), "llm_response": llm_resp_display},
                )
                yield _sse({"type": "answer", "content": content})
                break

            # LLM chose tools
            tool_names = [tc["function"]["name"] for tc in tool_calls]
            tool_labels = [TOOL_DESCRIPTIONS.get(n, {}).get("zh", n) for n in tool_names]
            yield _step(
                "🎯",
                "LLM 决策：调用工具",
                f"Intent → {', '.join(tool_labels)} — {llm_ms}ms",
                f"LLM 推理耗时 {llm_ms}ms。\n"
                f"模型分析用户意图后，决定调用 {len(tool_calls)} 个工具：\n"
                + "\n".join(f"  • {TOOL_DESCRIPTIONS.get(n, {}).get('zh', n)} ({n})" for n in tool_names),
                status="done",
                extra={"llm_ms": llm_ms, "tool_names": tool_names, "llm_response": llm_resp_display},
            )

            if content:
                yield _step("💭", "LLM 中间思考", "Intermediate Reasoning", content, status="done")

            messages.append(msg)

            for tc_idx, tc in enumerate(tool_calls):
                fn_name = tc["function"]["name"]
                fn_args = tc["function"]["arguments"]
                desc = TOOL_DESCRIPTIONS.get(fn_name, {})

                args_str = json.dumps(fn_args, ensure_ascii=False, indent=2)
                yield _step(
                    "📋",
                    f"构造工具参数：{desc.get('zh', fn_name)}",
                    f"Preparing {fn_name}()",
                    f"函数名：{fn_name}\n说明：{desc.get('detail', '—')}\n参数：\n{args_str}",
                    status="done",
                    extra={"tool_name": fn_name, "tool_args": fn_args},
                )

                yield _step(
                    "⚙️",
                    f"执行工具：{desc.get('zh', fn_name)}",
                    f"Running {fn_name}()…",
                    f"正在执行 {fn_name}…\n{desc.get('detail', '')}",
                    status="running",
                    extra={"tool_name": fn_name},
                )

                t_tool = time.time()
                func = TOOL_FUNCTIONS.get(fn_name)
                if func:
                    try:
                        result = func(**fn_args)
                    except Exception as e:
                        result = {"error": str(e)}
                else:
                    result = {"error": f"Unknown tool: {fn_name}"}
                tool_ms = round((time.time() - t_tool) * 1000)

                vis_b64 = result.pop("visualization_base64", None)

                result_summary_parts = []
                for k, v in result.items():
                    if k in ("match_details_top10", "rankings"):
                        result_summary_parts.append(f"  {k}: [{len(v)} items]")
                    else:
                        result_summary_parts.append(f"  {k}: {v}")
                result_summary = "\n".join(result_summary_parts)

                has_error = "error" in result
                yield _step(
                    "❌" if has_error else "📊",
                    f"工具返回结果：{desc.get('zh', fn_name)}",
                    f"{fn_name} → {'ERROR' if has_error else 'OK'} — {tool_ms}ms",
                    f"执行耗时：{tool_ms}ms\n{'有' if vis_b64 else '无'}可视化图像\n返回数据：\n{result_summary}",
                    status="error" if has_error else "done",
                    extra={"tool_name": fn_name, "tool_ms": tool_ms, "tool_result": result, "has_vis": bool(vis_b64)},
                )

                if vis_b64:
                    yield _sse({"type": "visualization", "name": fn_name, "image_base64": vis_b64})

                messages.append(
                    {
                        "role": "tool",
                        "content": json.dumps(result, ensure_ascii=False),
                    }
                )

        # Update skill execution stats if a skill was used
        if matched_skill:
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            matched_skill["execution_count"] = matched_skill.get("execution_count", 0) + 1
            matched_skill["last_executed_at"] = now
            log = matched_skill.get("execution_log", [])
            log.append(
                {
                    "at": now,
                    "context": skill_remainder,
                    "success": True,
                    "duration_ms": round((time.time() - t_start) * 1000),
                }
            )
            matched_skill["execution_log"] = log[-20:]
            _save_skill(matched_skill)

        yield _step(
            "✅",
            "流程结束",
            "Pipeline Complete",
            f"总耗时：{round((time.time() - t_start) * 1000)}ms，共 {round_num} 轮 LLM 调用",
            status="done",
            extra={"total_ms": round((time.time() - t_start) * 1000)},
        )
        yield _sse({"type": "done"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ─── Conversation Persistence API ─────────────────────────────────────

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")


def _conv_path(conv_id: str) -> Path:
    if not _SAFE_ID.match(conv_id):
        raise ValueError("Invalid conversation id")
    return CONVERSATIONS_DIR / f"{conv_id}.json"


@app.get("/api/conversations")
async def api_list_conversations():
    convos = []
    for f in sorted(CONVERSATIONS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            meta = json.loads(f.read_text(encoding="utf-8"))
            convos.append(
                {
                    "id": f.stem,
                    "title": meta.get("title", "未命名对话"),
                    "created_at": meta.get("created_at", ""),
                    "updated_at": meta.get("updated_at", ""),
                    "message_count": len(meta.get("chatHistory", [])),
                }
            )
        except Exception:
            continue
    return {"conversations": convos}


@app.post("/api/conversations")
async def api_save_conversation(request: Request):
    body = await request.json()
    conv_id = body.get("id") or uuid.uuid4().hex[:12]
    body["id"] = conv_id
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    if not body.get("created_at"):
        body["created_at"] = now
    body["updated_at"] = now
    CONVERSATIONS_DIR.mkdir(exist_ok=True)
    path = _conv_path(conv_id)
    path.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "id": conv_id, "updated_at": now}


@app.get("/api/conversations/{conv_id}")
async def api_load_conversation(conv_id: str):
    path = _conv_path(conv_id)
    if not path.exists():
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
    data = json.loads(path.read_text(encoding="utf-8"))
    return data


@app.delete("/api/conversations/{conv_id}")
async def api_delete_conversation(conv_id: str):
    path = _conv_path(conv_id)
    if path.exists():
        path.unlink()
    return {"ok": True}


@app.patch("/api/conversations/{conv_id}")
async def api_rename_conversation(conv_id: str, request: Request):
    path = _conv_path(conv_id)
    if not path.exists():
        return JSONResponse({"error": "Conversation not found"}, status_code=404)
    data = json.loads(path.read_text(encoding="utf-8"))
    body = await request.json()
    if "title" in body:
        data["title"] = body["title"]
    data["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


# ─── AI Config & Provider API ────────────────────────────────────────


@app.get("/api/ai-config")
async def api_get_ai_config():
    return load_ai_config()


@app.post("/api/ai-config")
async def api_save_ai_config(request: Request):
    body = await request.json()
    save_ai_config(body)
    return {"ok": True}


@app.get("/api/ollama-models")
async def api_ollama_models():
    config = load_ai_config()
    ollama_url = config.get("providers", {}).get("ollama", {}).get("base_url", OLLAMA_URL)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = data.get("models", [])
            return {
                "models": [
                    {
                        "name": m["name"],
                        "size": m.get("size", 0),
                        "modified_at": m.get("modified_at", ""),
                        "family": m.get("details", {}).get("family", ""),
                        "parameter_size": m.get("details", {}).get("parameter_size", ""),
                        "quantization": m.get("details", {}).get("quantization_level", ""),
                    }
                    for m in models
                ],
                "count": len(models),
            }
    except httpx.ConnectError:
        return JSONResponse({"error": "Ollama 服务未运行或无法连接", "models": []}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": str(e), "models": []}, status_code=500)


@app.post("/api/ai-test")
async def api_test_provider(request: Request):
    body = await request.json()
    provider = body.get("provider", "")
    base_url = body.get("base_url", "")
    api_key = body.get("api_key", "")
    model = body.get("model", "")

    try:
        if provider == "ollama":
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{base_url}/api/chat",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": "Say hello in one word."}],
                        "stream": False,
                        "options": {"num_predict": 20},
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                reply = data.get("message", {}).get("content", "")
                return {"ok": True, "reply": reply, "model": model}
        else:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": "Say hello in one word."}],
                "max_tokens": 20,
                "stream": False,
            }
            if provider == "minimax":
                payload["tokens_to_generate"] = 20
                payload.pop("max_tokens", None)

            async with httpx.AsyncClient(timeout=20.0) as client:
                chat_url = f"{base_url}/chat/completions"
                if provider == "minimax":
                    chat_url = f"{base_url}/text/chatcompletion_v2"
                resp = await client.post(chat_url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                reply = ""
                if "choices" in data and data["choices"]:
                    reply = data["choices"][0].get("message", {}).get("content", "")
                return {"ok": True, "reply": reply, "model": model}
    except httpx.ConnectError:
        return JSONResponse({"ok": False, "error": "无法连接到服务"}, status_code=503)
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.json()
        except Exception:
            detail = e.response.text[:300]
        return JSONResponse(
            {"ok": False, "error": f"HTTP {e.response.status_code}", "detail": detail},
            status_code=e.response.status_code,
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ─── Skills CRUD API ──────────────────────────────────────────────────

_SAFE_SKILL_ID = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")


def _skill_path(skill_id: str) -> Path:
    if not _SAFE_SKILL_ID.match(skill_id):
        raise ValueError("Invalid skill id")
    return SKILLS_DIR / f"{skill_id}.json"


def _load_skill(skill_id: str) -> Optional[dict]:
    p = _skill_path(skill_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _save_skill(skill: dict):
    p = _skill_path(skill["id"])
    p.write_text(json.dumps(skill, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_all_skills() -> list[dict]:
    skills = []
    for f in sorted(SKILLS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            skills.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    return skills


@app.get("/api/skills")
async def api_list_skills():
    skills = _load_all_skills()
    summaries = []
    for s in skills:
        versions = s.get("versions", [])
        active_ver = next(
            (v for v in versions if v.get("version") == s.get("active_version")), versions[-1] if versions else {}
        )
        has_instructions = bool(active_ver.get("system_prompt_addon", ""))
        summaries.append(
            {
                "id": s["id"],
                "name": s.get("name", ""),
                "description": s.get("description", ""),
                "keywords": s.get("keywords", []),
                "has_instructions": has_instructions,
                "version_count": len(versions),
                "active_version": s.get("active_version", 1),
                "enabled": s.get("enabled", True),
                "execution_count": s.get("execution_count", 0),
                "last_executed_at": s.get("last_executed_at"),
                "created_at": s.get("created_at", ""),
                "updated_at": s.get("updated_at", ""),
            }
        )
    return {"skills": summaries, "count": len(summaries)}


@app.get("/api/skills/{skill_id}")
async def api_get_skill(skill_id: str):
    skill = _load_skill(skill_id)
    if not skill:
        return JSONResponse({"error": "Skill not found"}, status_code=404)
    return skill


@app.post("/api/skills")
async def api_create_skill(request: Request):
    body = await request.json()
    skill_id = (
        body.get("id") or re.sub(r"[^a-zA-Z0-9_-]", "_", body.get("name", "skill"))[:48] + "_" + uuid.uuid4().hex[:6]
    )
    if _skill_path(skill_id).exists():
        return JSONResponse({"error": "Skill with this id already exists"}, status_code=409)

    now = time.strftime("%Y-%m-%d %H:%M:%S")
    skill = {
        "id": skill_id,
        "name": body.get("name", "Unnamed Skill"),
        "description": body.get("description", ""),
        "keywords": body.get("keywords", []),
        "versions": [
            {
                "version": 1,
                "created_at": now,
                "author": "user",
                "changelog": body.get("changelog", "Initial capture from conversation"),
                "system_prompt_addon": body.get("system_prompt_addon", ""),
                "suggested_workflow": body.get("suggested_workflow", []),
            }
        ],
        "active_version": 1,
        "enabled": body.get("enabled", True),
        "execution_count": 0,
        "last_executed_at": None,
        "execution_log": [],
        "created_at": now,
        "updated_at": now,
    }
    _save_skill(skill)
    return {"ok": True, "id": skill_id, "skill": skill}


@app.put("/api/skills/{skill_id}")
async def api_update_skill(skill_id: str, request: Request):
    skill = _load_skill(skill_id)
    if not skill:
        return JSONResponse({"error": "Skill not found"}, status_code=404)
    body = await request.json()
    for key in ("name", "description", "keywords", "enabled", "active_version"):
        if key in body:
            skill[key] = body[key]
    skill["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    _save_skill(skill)
    return {"ok": True, "skill": skill}


@app.post("/api/skills/{skill_id}/versions")
async def api_add_skill_version(skill_id: str, request: Request):
    skill = _load_skill(skill_id)
    if not skill:
        return JSONResponse({"error": "Skill not found"}, status_code=404)
    body = await request.json()
    versions = skill.get("versions", [])
    next_ver = max((v["version"] for v in versions), default=0) + 1
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    new_version = {
        "version": next_ver,
        "created_at": now,
        "author": body.get("author", "user"),
        "changelog": body.get("changelog", ""),
        "system_prompt_addon": body.get("system_prompt_addon", ""),
        "suggested_workflow": body.get("suggested_workflow", []),
    }
    versions.append(new_version)
    skill["versions"] = versions
    skill["active_version"] = next_ver
    skill["updated_at"] = now
    _save_skill(skill)
    return {"ok": True, "version": next_ver, "skill": skill}


@app.delete("/api/skills/{skill_id}")
async def api_delete_skill(skill_id: str):
    p = _skill_path(skill_id)
    if p.exists():
        p.unlink()
    return {"ok": True}


@app.get("/api/skills/{skill_id}/diff/{v1}/{v2}")
async def api_skill_diff(skill_id: str, v1: int, v2: int):
    skill = _load_skill(skill_id)
    if not skill:
        return JSONResponse({"error": "Skill not found"}, status_code=404)
    versions = {v["version"]: v for v in skill.get("versions", [])}
    ver_a = versions.get(v1)
    ver_b = versions.get(v2)
    if not ver_a or not ver_b:
        return JSONResponse({"error": "Version not found"}, status_code=404)
    text_a = ver_a.get(
        "system_prompt_addon", json.dumps(ver_a.get("steps", []), ensure_ascii=False, indent=2)
    ).splitlines(keepends=True)
    text_b = ver_b.get(
        "system_prompt_addon", json.dumps(ver_b.get("steps", []), ensure_ascii=False, indent=2)
    ).splitlines(keepends=True)
    diff_lines = list(difflib.unified_diff(text_a, text_b, fromfile=f"v{v1}", tofile=f"v{v2}", lineterm=""))
    return {
        "skill_id": skill_id,
        "v1": v1,
        "v2": v2,
        "diff": diff_lines,
        "version_a": ver_a,
        "version_b": ver_b,
    }


def _generate_skill_instructions_mechanical(tool_steps: list[dict]) -> str:
    """Produce structured natural-language instructions from a tool call sequence (no LLM needed)."""
    lines = ["当用户触发此技能时，请按以下流程依次调用工具完成任务：\n"]
    for i, ts in enumerate(tool_steps):
        desc_zh = TOOL_DESCRIPTIONS.get(ts["tool"], {}).get("zh", ts["tool"])
        args_desc_parts = []
        for k, v in ts["args"].items():
            if isinstance(v, str) and "." in v:
                args_desc_parts.append(f"{k}=用户指定的图像")
            elif isinstance(v, list) and len(v) > 3:
                args_desc_parts.append(f"{k}=所有可用图像列表（先调用 list_available_images 获取）")
            elif isinstance(v, list):
                args_desc_parts.append(f"{k}=用户指定的图像列表")
            else:
                args_desc_parts.append(f"{k}={v}")
        args_hint = "，".join(args_desc_parts) if args_desc_parts else "无参数"
        lines.append(f"{i + 1}. 调用 `{ts['tool']}`（{desc_zh}）— {args_hint}")
    lines.append("")
    lines.append("完成所有工具调用后，综合所有结果给用户一个清晰的总结分析。")
    lines.append("如果某个工具调用失败，说明错误原因并尝试继续执行后续步骤。")
    lines.append("请使用用户消息中提到的实际图像名称作为参数，不要使用占位符。")
    return "\n".join(lines)


async def _generate_skill_instructions_llm(
    tool_steps: list[dict], active_provider: str, provider_cfg: dict
) -> Optional[str]:
    """Ask the LLM to produce high-quality reusable instructions from a tool call trace."""
    trace_lines = []
    for i, ts in enumerate(tool_steps):
        desc_zh = TOOL_DESCRIPTIONS.get(ts["tool"], {}).get("zh", ts["tool"])
        trace_lines.append(
            f"Step {i + 1}: {ts['tool']} ({desc_zh}) — args: {json.dumps(ts['args'], ensure_ascii=False)}"
        )
    trace_text = "\n".join(trace_lines)

    meta_prompt = f"""你是一个AI技能设计师。下面是一个视觉分析Agent的工具调用记录。
请将这个工具调用流程总结为一段**可复用的自然语言指令**，用于指导Agent在未来遇到类似任务时如何行动。

要求：
- 用中文书写
- 描述每一步应该做什么、使用哪个工具、参数应该怎么确定
- 参数应该引用"用户指定的图像"而不是具体的文件名（因为每次执行时图像不同）
- 包含错误处理建议（如果某步失败应如何处理）
- 最后要求Agent综合所有结果给出分析总结
- 不要使用{{}}模板语法，用自然语言描述参数来源

工具调用记录：
{trace_text}

可用工具：
- list_available_images: 列出所有可用图像
- vision_tool_detect_keypoints: 检测单张图像的 ORB 关键点
- vision_tool_match_images: 匹配两张图像的 ORB 特征
- vision_tool_compare_multiple: 将查询图与多张图批量比较排名

请直接输出指令文本，不要添加标题或解释。/no_think"""

    try:
        model = provider_cfg.get("model", "")
        base_url = provider_cfg.get("base_url", "")
        api_key = provider_cfg.get("api_key", "")

        if active_provider == "ollama":
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": meta_prompt}],
                "stream": False,
                "options": {"temperature": 0.4, "num_predict": 4096},
            }
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(f"{base_url}/api/chat", json=payload)
                resp.raise_for_status()
                data = resp.json()
            msg = data.get("message", {})
            content = msg.get("content", "")
            if not content.strip():
                content = msg.get("thinking", "")
        else:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            chat_url = f"{base_url}/chat/completions"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": meta_prompt}],
                "temperature": 0.4,
                "max_tokens": 4096,
                "stream": False,
            }
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(chat_url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        if len(content) > 50:
            return content
        print(f"[skill-capture] LLM returned too-short content ({len(content)} chars): {content!r}")
    except Exception as exc:
        print(f"[skill-capture] LLM instruction generation failed ({active_provider}): {exc}")
        traceback.print_exc()
    return None


@app.post("/api/skills/capture")
async def api_capture_skill(request: Request):
    """Extract a reusable skill from conversation steps: generates LLM instructions + a reference workflow."""
    body = await request.json()
    steps_raw = body.get("steps", [])

    tool_steps = []
    for s in steps_raw:
        if s.get("tool_name") and s.get("tool_args") is not None:
            tool_steps.append({"tool": s["tool_name"], "args": s["tool_args"], "description": s.get("title", "")})

    if not tool_steps:
        return {"error": "No tool calls found in steps"}

    suggested_workflow = [
        {
            "tool": ts["tool"],
            "description": ts["description"] or TOOL_DESCRIPTIONS.get(ts["tool"], {}).get("zh", ts["tool"]),
        }
        for ts in tool_steps
    ]

    mechanical = _generate_skill_instructions_mechanical(tool_steps)

    ai_config = load_ai_config()
    active_provider = ai_config.get("active_provider", "ollama")
    provider_cfg = ai_config.get("providers", {}).get(active_provider, PROVIDER_DEFAULTS.get(active_provider, {}))
    llm_instructions = await _generate_skill_instructions_llm(tool_steps, active_provider, provider_cfg)

    return {
        "system_prompt_addon": llm_instructions or mechanical,
        "suggested_workflow": suggested_workflow,
        "tool_count": len(tool_steps),
        "llm_generated": llm_instructions is not None,
    }


@app.post("/api/skills/{skill_id}/execute")
async def api_execute_skill(skill_id: str, request: Request):
    """Preview a skill's instructions and suggested workflow (skills are now LLM-driven via /api/chat)."""
    skill = _load_skill(skill_id)
    if not skill:
        return JSONResponse({"error": "Skill not found"}, status_code=404)
    active_ver = skill.get("active_version", 1)
    version = None
    for v in skill.get("versions", []):
        if v["version"] == active_ver:
            version = v
            break
    if not version:
        return JSONResponse({"error": "Active version not found"}, status_code=404)

    return {
        "skill_id": skill_id,
        "version": active_ver,
        "system_prompt_addon": version.get("system_prompt_addon", ""),
        "suggested_workflow": version.get("suggested_workflow", []),
        "hint": "Skills are now LLM-driven. Use /api/chat with a skill keyword to execute.",
    }


@app.post("/api/skills/import")
async def api_import_skill(request: Request):
    """Import a skill from JSON."""
    body = await request.json()
    skill_id = body.get("id")
    if not skill_id or not _SAFE_SKILL_ID.match(skill_id):
        return JSONResponse({"error": "Invalid skill id"}, status_code=400)
    body["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    _save_skill(body)
    return {"ok": True, "id": skill_id}


# ─── Generate Test Images ──────────────────────────────────────────────


def generate_test_images():
    """Generate diverse procedural test images if none exist."""
    if any(IMAGES_DIR.glob("*.jpg")):
        return

    IMAGES_DIR.mkdir(exist_ok=True)
    S = 480

    def _save(name, img):
        _cv2_imwrite(str(IMAGES_DIR / name), img)

    # Scene A: Cityscape with buildings
    np.random.seed(42)
    img = np.zeros((S, S, 3), dtype=np.uint8)
    img[: S // 2] = [180, 140, 100]  # sky (BGR)
    img[S // 2 :] = [80, 80, 80]  # ground
    for i in range(8):
        x = np.random.randint(10, S - 80)
        w = np.random.randint(30, 80)
        h = np.random.randint(60, 200)
        c = np.random.randint(40, 120)
        cv2.rectangle(img, (x, S // 2 - h), (x + w, S // 2), (c, c + 10, c + 20), -1)
        for wy in range(S // 2 - h + 10, S // 2 - 5, 18):
            for wx in range(x + 6, x + w - 6, 14):
                cv2.rectangle(img, (wx, wy), (wx + 8, wy + 10), (200, 200, 140), -1)
    cv2.line(img, (0, S // 2), (S, S // 2), (60, 60, 60), 2)
    for i in range(15):
        x = np.random.randint(0, S)
        y = np.random.randint(S // 2 + 10, S - 10)
        cv2.circle(img, (x, y), 3, (40, 40, 50), -1)
    _save("city_day.jpg", img)

    # Scene A2: Same city, different angle (rotated + shifted)
    M = cv2.getRotationMatrix2D((S // 2, S // 2), 8, 0.92)
    M[0, 2] += 25
    img2 = cv2.warpAffine(img, M, (S, S), borderValue=(80, 80, 80))
    noise = np.random.randint(0, 15, img2.shape, dtype=np.uint8)
    img2 = cv2.add(img2, noise)
    _save("city_angle2.jpg", img2)

    # Scene B: Forest / nature
    np.random.seed(100)
    img = np.zeros((S, S, 3), dtype=np.uint8)
    for y in range(S):
        t = y / S
        img[y] = [int(180 - t * 80), int(200 - t * 60), int(100 + t * 40)]
    for i in range(25):
        x = np.random.randint(0, S)
        base_y = S // 2 + np.random.randint(-30, 80)
        trunk_h = np.random.randint(40, 120)
        cv2.rectangle(img, (x - 4, base_y), (x + 4, base_y - trunk_h // 3), (30, 60, 80), -1)
        pts = np.array([[x, base_y - trunk_h], [x - 25, base_y - trunk_h // 3], [x + 25, base_y - trunk_h // 3]])
        green = (np.random.randint(20, 60), np.random.randint(80, 160), np.random.randint(20, 60))
        cv2.fillPoly(img, [pts], green)
    img[S * 3 // 4 :] = [40, 100, 60]
    _save("forest.jpg", img)

    # Scene C: Beach / ocean
    np.random.seed(200)
    img = np.zeros((S, S, 3), dtype=np.uint8)
    for y in range(S):
        t = y / S
        if t < 0.4:
            img[y] = [int(200 - t * 100), int(160 - t * 60), int(120 + t * 50)]
        elif t < 0.6:
            img[y] = [int(180 * (1 - t)), int(200 * (1 - t) + 50), 220]
        else:
            img[y] = [int(150 + (t - 0.6) * 80), int(180 + (t - 0.6) * 60), int(200 + (t - 0.6) * 40)]
    for i in range(10):
        x1 = np.random.randint(0, S)
        y1 = int(S * 0.55 + np.random.randint(0, S // 4))
        cv2.line(img, (x1, y1), (x1 + np.random.randint(20, 80), y1 + np.random.randint(-3, 3)), (200, 190, 170), 1)
    _save("beach.jpg", img)

    # Scene D: Indoor room
    np.random.seed(300)
    img = np.full((S, S, 3), (120, 130, 140), dtype=np.uint8)
    cv2.rectangle(img, (0, S * 3 // 5), (S, S), (100, 110, 120), -1)  # floor
    cv2.line(img, (0, S * 3 // 5), (S, S * 3 // 5), (80, 80, 80), 2)
    for i in range(4):
        x = 40 + i * 110
        cv2.rectangle(img, (x, S // 5), (x + 70, S // 5 + 90), (50, 80, 100), -1)
        cv2.rectangle(img, (x + 5, S // 5 + 5), (x + 65, S // 5 + 85), (120, 160, 200), -1)
    cv2.rectangle(img, (S // 3, S * 3 // 5 - 60), (S * 2 // 3, S * 3 // 5), (60, 80, 100), -1)
    for i in range(6):
        x = np.random.randint(20, S - 50)
        y = np.random.randint(S * 3 // 5 + 10, S - 40)
        w = np.random.randint(20, 50)
        h = np.random.randint(15, 35)
        c = tuple(int(v) for v in np.random.randint(60, 180, 3))
        cv2.rectangle(img, (x, y), (x + w, y + h), c, -1)
    _save("indoor.jpg", img)

    # Scene E: Night city
    np.random.seed(400)
    img = np.zeros((S, S, 3), dtype=np.uint8)
    img[:] = [30, 20, 15]
    for i in range(10):
        x = np.random.randint(10, S - 80)
        w = np.random.randint(30, 80)
        h = np.random.randint(80, 220)
        c = np.random.randint(15, 40)
        cv2.rectangle(img, (x, S // 2 - h), (x + w, S // 2), (c, c, c + 5), -1)
        for wy in range(S // 2 - h + 8, S // 2 - 5, 14):
            for wx in range(x + 5, x + w - 5, 12):
                if np.random.random() > 0.3:
                    brightness = np.random.randint(100, 255)
                    warmth = np.random.randint(0, 50)
                    cv2.rectangle(img, (wx, wy), (wx + 6, wy + 6), (warmth, brightness // 2, brightness), -1)
    img[S // 2 :] = [25, 25, 25]
    for i in range(30):
        x = np.random.randint(0, S)
        y = np.random.randint(S // 2, S)
        c = (np.random.randint(0, 100), np.random.randint(0, 50), np.random.randint(100, 255))
        cv2.circle(img, (x, y), np.random.randint(2, 5), c, -1)
    _save("night_city.jpg", img)

    # Scene F: Mountain landscape
    np.random.seed(500)
    img = np.zeros((S, S, 3), dtype=np.uint8)
    for y in range(S):
        t = y / S
        img[y] = [int(200 - t * 80), int(170 - t * 40), int(140 + t * 30)]
    pts = []
    for x in range(0, S + 20, 20):
        y = int(S * 0.35 + np.sin(x * 0.015) * 40 + np.random.randint(-15, 15))
        pts.append([x, y])
    pts.append([S, S])
    pts.append([0, S])
    cv2.fillPoly(img, [np.array(pts)], (80, 100, 90))
    peak_pts = np.array([[S // 3, S * 35 // 100 - 60], [S // 2, S * 35 // 100 - 140], [S * 2 // 3, S * 35 // 100 - 50]])
    cv2.fillPoly(img, [peak_pts], (200, 200, 210))
    tip_pts = np.array(
        [[S // 2 - 15, S * 35 // 100 - 110], [S // 2, S * 35 // 100 - 140], [S // 2 + 15, S * 35 // 100 - 110]]
    )
    cv2.fillPoly(img, [tip_pts], (240, 240, 250))
    img[S * 7 // 10 :] = [50, 110, 70]
    _save("mountain.jpg", img)

    # Duplicate of city for testing "same scene" detection
    city = cv2.imread(str(IMAGES_DIR / "city_day.jpg"))
    M = cv2.getRotationMatrix2D((S // 2, S // 2), -5, 1.05)
    city2 = cv2.warpAffine(city, M, (S, S), borderValue=(80, 80, 80))
    city2 = cv2.GaussianBlur(city2, (3, 3), 0)
    _save("city_rotated.jpg", city2)

    # Duplicate of forest for testing
    forest = cv2.imread(str(IMAGES_DIR / "forest.jpg"))
    flipped = cv2.flip(forest, 1)
    noise = np.random.randint(0, 20, flipped.shape, dtype=np.uint8)
    flipped = cv2.add(flipped, noise)
    _save("forest_mirror.jpg", flipped)

    print(f"✅ Generated {len(list(IMAGES_DIR.glob('*.jpg')))} test images in {IMAGES_DIR}")


# ─── Main ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    generate_test_images()
    import uvicorn

    print("\n🚀 Demo 5 — LLM Tool Calling × Vision")
    print(f"   Model: {MODEL_NAME}")
    print(f"   Ollama: {OLLAMA_URL}")
    print("   Open: http://localhost:8765\n")
    uvicorn.run(app, host="0.0.0.0", port=8765)
