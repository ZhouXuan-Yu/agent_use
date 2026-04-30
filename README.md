# Demo 5 — LLM Tool Calling × 传统视觉算法

FastAPI 后端 + 单页前端：Ollama / OpenAI 兼容 API + ORB 等 vision tools（Function Calling）。

## 运行

# 解决端口冲突问题
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue).OwningProcess -Force; & "D:\Anaconda\envs\DemoLearn\python.exe" "D:\Aprogress\class-prep\digital_image_processing\2526s2\角点检测 Corner Detection\demo5_llm_tool_calling\server.py"

```bash
pip install fastapi uvicorn httpx opencv-python numpy python-multipart pytest
python server.py
# http://localhost:8765
```

需要本地 Ollama 或配置云端供应商（见页面 **AI 设置**）。

修改 `styles.css` 或 `js/` 后请**重启 `server.py`**，以便加载最新静态资源。

## Agent 技能（Skills）— LLM 驱动

技能与「固定脚本跑工具」不同：每条技能的 **`system_prompt_addon`** 会注入系统提示，由 **LLM 自主决定何时调用哪些工具**（对齐 Anthropic 等提出的 *Agent Skills* 思路：可加载的说明性上下文，而非硬编码控制流）。

### 数据模型（要点）

| 字段 | 含义 |
|------|------|
| `keywords` | 用户消息里命中关键词即激活该技能（见 `_match_skill`） |
| `system_prompt_addon` | 注入系统提示的自然语言指令（主配置） |
| `suggested_workflow` | 仅作 UI 展示的参考步骤列表，**不**被后端按序执行 |
| `versions` / `active_version` | 版本与变更说明；支持 diff（比较 `system_prompt_addon` 文本） |

技能文件位于 `skills/*.json`，由后端读写。

### 行为说明

- **激活**：用户消息以某关键词开头（忽略大小写）时，服务端在系统提示末尾追加「**强制技能说明**」块，要求模型按说明执行、**不要擅自省略步骤**（避免模型「过度优化」跳过例如 `vision_tool_compare_multiple`）。
- **保存为技能**：对话追踪条上的「保存为技能」可把一次运行的工具轨迹发到 `POST /api/skills/capture`。服务端会尝试用当前 **AI 设置** 里的模型生成指令文本；失败则使用机械模板。
- **「✓ LLM 生成」与「机械生成」**：捕获接口返回 `llm_generated`。若 Ollama「思考模型」把内容写在 `thinking` 字段、或 `content` 过短，旧版会误判为失败；当前实现已加大 `num_predict`、空 `content` 时回退读 `thinking`，并对纯文本请求**省略空的 `tools` 字段**，以减少失败率。

### 相关 API（节选）

- `GET/POST /api/skills`、`GET /api/skills/{id}`、`PUT /api/skills/{id}`
- `POST /api/skills/capture` — 从步骤生成 `system_prompt_addon` + `suggested_workflow`
- `POST /api/skills/{id}/execute` — **预览**当前版本的指令与工作流（真正执行走带关键词的 `/api/chat`）
- `GET /api/skills/{id}/diff/{v1}/{v2}` — 文本 diff

## 前端结构（组件化）

原先单文件 `index.html`（内联 CSS + JS）已拆分为：

| 路径 | 说明 |
|------|------|
| `index.html` | 页面骨架与 `<script src="js/...">` 加载顺序 |
| `styles.css` | 全部样式 |
| `js/utils.js` | `escapeHtml`、`formatMarkdown`、JSON 高亮、lightbox |
| `js/state.js` | 共享可变状态 `App.state` 与 `resetLastRunData` / `resetToolCallData` |
| `js/resize.js` | 对话区高度、右侧工具箱宽度（localStorage 持久化） |
| `js/json-panels.js` | 流水线详情里的结构化 JSON 面板 |
| `js/image-library.js` | 图像库加载、多选、上传 |
| `js/pipeline.js` | 顶部动态流水线、`buildDynamicPipeline`、`renderPhaseDetail` |
| `js/toolbox.js` | 工具箱卡片、静态说明、运行时参数/结果展示 |
| `js/skills.js` | 技能列表、捕获弹窗、工具箱内技能入口 |
| `js/skill-editor.js` | Skills 标签页详情、编辑、版本与 diff |
| `js/chat.js` | 消息渲染、瀑布流追踪、`sendMessage`、SSE 解析、追踪条「保存为技能」 |
| `js/settings.js` | AI 供应商、Ollama 模型表、`PROVIDER_META` |
| `js/conversation.js` | 对话持久化、抽屉、历史加载后补绑「保存为技能」按钮 |
| `js/app.js` | 启动：绑定 lightbox、调用各模块 `init*` |

全局命名空间为 **`window.App`**（无打包器，按依赖顺序用 `<script>` 引入）。

## 后端静态资源

`server.py` 提供：

- `GET /` — 返回 `index.html` 文本
- `GET /styles.css` — `FileResponse` 样式表
- `GET /js/*` — `StaticFiles` 挂载到 `js/` 目录

若浏览器出现「无样式」的纯 HTML，通常是**旧进程未重启**或请求未命中上述路由。

## 架构流水线（页面顶部）

- **动态生成**：每一轮用户消息结束后，流水线由 `App.state.lastRunData.steps`（与 `/api/chat` SSE 的 `type: "step"` 事件一一对应）渲染。
- **统计标题**：`#pipeline-stats` 显示总耗时、LLM 轮次数（图标 🧠）、工具执行次数（⚙️）、Ollama `eval_count` / `prompt_eval_count` 汇总的 token 数、助手回答字数、步骤总数。
- **横向滚动**：`#pipeline-flow` 使用 `overflow-x: auto`；新步骤出现时脚本将滚动条置右。
- **详情**：点击某步调用 `renderDynamicPipeDetail` / `renderPhaseDetail`，展示该阶段的说明及 `llm_request` / `llm_response` / `tool_args` / `tool_result`。

## 主界面（图像库 + 对话 + 工具箱）

- **对话区默认更高**：消息列表 `#chat-messages` 默认高度约 600px（最小 300px），便于阅读长回答与瀑布流追踪。
- **拖动调整高度**：消息列表下方有拖动条（`#chat-resize-handle`）。高度保存在 `localStorage`，键名 `demo5_chat_height`。
- **已移除的区块**：页面底部曾有的静态「工具代码」示例已删除；工具说明以右侧工具箱与运行时追踪为准。
- **Skills 标签页**：顶部 tab「⚡ Skills」进入技能管理（列表 / 详情 / 版本与 diff）。

## CLI（供 Agent / 自动化使用）

`cli.py` 将 ORB 视觉工具暴露为命令行接口，所有输出均为 **JSON**（stdout），
适合 OpenClaw、Hermes 等 Agent 直接调用。

```bash
# 列出可用图像
python cli.py list

# 检测关键点（可视化写入文件）
python cli.py detect city_day.jpg -o keypoints.jpg

# 匹配两张图像
python cli.py match city_day.jpg city_angle2.jpg -o match_vis.jpg

# 以一张图查询所有图像并排名
python cli.py search city_day.jpg --all

# 指定候选集
python cli.py search city_day.jpg forest.jpg beach.jpg mountain.jpg

# 使用任意路径（不限于 test_images/）
python cli.py detect /tmp/photo.png
python cli.py match ./a.jpg ./b.jpg -o result.jpg

# 额外搜索目录
python cli.py list --db-dir /path/to/my_images
python cli.py search query.jpg --all --db-dir /data/images

# 生成测试图像（首次运行可选）
python cli.py generate
```

不加 `-o` 时，可视化以 `visualization_base64`（JPEG base64）出现在 JSON 中。
错误时输出 `{"error": "..."}` 并以非零退出码返回。

## 测试

在 **本目录** 运行：

```bash
python -m pytest tests/ -v
```

- `tests/test_frontend_contract.py`：对 `index.html` + `styles.css` + `js/*.js` 做字符串契约测试，防止破坏关键 DOM、样式与 `App.*` 行为。
- `tests/test_server.py`：ASGI 接口测试（含静态路由、对话与技能 API 等；LLM 调用通过 mock）。

仓库根目录 **`tools/verify_demos.sh`**（pre-push 钩子）会运行角点检测系列 `demo*.py`、若干 HTML 探针，并在本目录执行上述 pytest。
