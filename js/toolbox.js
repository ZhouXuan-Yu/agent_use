/**
 * toolbox.js — Tool sidebar: card highlights, detail panel, static tool info.
 */
'use strict';

window.App = window.App || {};

App.TOOL_STATIC = {
  'vision_tool_detect_keypoints': {
    icon: '🔑',
    title: '关键点检测工具',
    fnName: 'vision_tool_detect_keypoints',
    what: '用 <strong>ORB 算法</strong>扫描一张图，找出图中所有"有辨识度的点"——角、边缘、纹理拐点等。这些点就是图像的"指纹"，是后续做匹配、检索的基础。',
    human: '就像你看一栋楼，会注意到窗户角、屋顶尖、门框边这些"有特征的地方"——这个工具自动帮你把图里所有这样的点全找出来，还画在图上给你看。',
    params: [
      { name: 'image_name', type: 'string', desc: '图像文件名，比如 "city_day.jpg"' },
    ],
    returns: '关键点数量、图像尺寸、描述子维度、带绿色圆圈标注的可视化图。',
    tags: ['ORB', 'Keypoint Detection', 'Feature Extraction', 'cv2.ORB_create'],
    code: `orb = cv2.ORB_create(500)
kps, des = orb.detectAndCompute(gray, None)
vis = cv2.drawKeypoints(color, kps, None,
    color=(0, 255, 0),
    flags=cv2.DRAW_MATCHES_FLAGS_DRAW_RICH_KEYPOINTS)`,
  },
  'vision_tool_match_images': {
    icon: '🔍',
    title: '图像匹配工具',
    fnName: 'vision_tool_match_images',
    what: '用 <strong>ORB + BFMatcher</strong> 比较两张图：先各自提取关键点和描述子，然后逐一对比描述子的 Hamming 距离。距离小于 50 的算"好匹配"，好匹配越多说明两张图越像。',
    human: '你把两张照片里"有特征的点"一个个拿出来对比——"这个角跟那个角像不像？"——像的越多，这两张图就越可能是拍的同一个地方。工具还会画一张连线图给你看。',
    params: [
      { name: 'image_name_1', type: 'string', desc: '第一张图像文件名' },
      { name: 'image_name_2', type: 'string', desc: '第二张图像文件名' },
      { name: 'top_k', type: 'int', desc: '取前 top_k 个最佳匹配（默认 30）' },
    ],
    returns: '两张图各自关键点数、好匹配数、平均距离、判定结论（高度/中度/低度/不匹配）、连线可视化图。',
    tags: ['ORB', 'BFMatcher', 'Hamming Distance', 'Feature Matching', 'Scene Recognition'],
    code: `orb = cv2.ORB_create(500)
kp1, d1 = orb.detectAndCompute(gray1, None)
kp2, d2 = orb.detectAndCompute(gray2, None)
bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
matches = sorted(bf.match(d1, d2), key=lambda m: m.distance)
good = [m for m in matches if m.distance < 50]`,
  },
  'vision_tool_compare_multiple': {
    icon: '🔎',
    title: '图像检索工具',
    fnName: 'vision_tool_compare_multiple',
    what: '把一张"查询图"跟数据库里的<strong>多张图</strong>逐一做 ORB 匹配，按好匹配数排名。相当于一个简易的<strong>图像检索引擎</strong>。',
    human: '你拿着一张照片问"数据库里哪张图跟我这张最像？"——工具逐个比过去，然后排个名告诉你：第一名是 xx，第二名是 yy……就像百度识图的原理（只不过这里用的是经典特征匹配）。',
    params: [
      { name: 'image_names', type: 'array', desc: '数据库图像文件名列表' },
      { name: 'query_image', type: 'string', desc: '你要查询的那张图的文件名' },
    ],
    returns: '排名列表（每张图的好匹配数、总匹配数、平均距离）、最佳匹配图名。',
    tags: ['Image Retrieval', 'ORB', 'Ranking', 'Similarity Search', 'CBIR'],
    code: `for name in image_names:
    _, d = orb.detectAndCompute(gray, None)
    matches = bf.match(d_query, d)
    good = [m for m in matches if m.distance < 50]
results.sort(key=lambda r: r["good_matches"], reverse=True)`,
  },
  'list_available_images': {
    icon: '📋',
    title: '列出可用图像',
    fnName: 'list_available_images',
    what: '扫描服务器上 <strong>test_images/</strong> 和 <strong>uploads/</strong> 两个文件夹，列出所有可用的图像文件名。LLM 在不确定有哪些图可用时会先调这个。',
    human: '就像你打开相册先看看里面有哪些照片——Agent 在帮你干活之前，也得先知道"我手头有哪些图可以用"。这是最基础但最常用的工具。',
    params: [],
    returns: '图片列表（文件名 + 来源文件夹）、总数。',
    tags: ['File Listing', 'Image Database', 'Inventory'],
    code: `for d in [IMAGES_DIR, UPLOAD_DIR]:
    for f in sorted(d.iterdir()):
        if f.suffix.lower() in {".jpg", ".jpeg", ".png", ...}:
            images.append({"name": f.name, "source": d.name})`,
  },
};

App.highlightToolCard = function(toolName) {
  const card = document.querySelector(`.tool-card[data-tool="${toolName}"]`);
  if (card) {
    card.classList.add('tool-just-called');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  App.state.lastCalledTool = toolName;
};

App.clearToolHighlights = function() {
  document.querySelectorAll('.tool-card').forEach(c => c.classList.remove('tool-just-called'));
};

App.captureToolCallData = function(event) {
  const tn = event.tool_name;
  if (!tn) return;
  if (!App.state.toolCallDataByName[tn]) {
    App.state.toolCallDataByName[tn] = { toolArgs: null, toolResult: null, elapsedMs: 0 };
  }
  const d = App.state.toolCallDataByName[tn];
  if (event.tool_args !== undefined) d.toolArgs = event.tool_args;
  if (event.tool_result !== undefined) {
    d.toolResult = event.tool_result;
    d.elapsedMs = event.tool_ms != null ? event.tool_ms : (event.elapsed_ms || 0);
  }
};

App.buildToolLiveHtml = function(toolName) {
  const d = App.state.toolCallDataByName[toolName];
  if (!d) return '';
  if (d.toolArgs == null && d.toolResult == null && !d.elapsedMs) return '';

  let html = '<div class="live-data" style="margin-top:12px;">';
  if (d.toolArgs != null) {
    html += `<div style="font-size:0.72rem;color:#8b949e;margin-bottom:4px;">🤖 LLM 刚才自动构造的参数：</div>`;
    html += `<div class="live-json">${App.formatJsonFull(d.toolArgs)}</div>`;
  }
  if (d.toolResult != null) {
    html += `<hr class="live-divider">`;
    html += `<div style="font-size:0.72rem;color:#8b949e;margin-bottom:4px;">📊 工具返回的结果：</div>`;
    const cleaned = typeof d.toolResult === 'object' ? {...d.toolResult} : d.toolResult;
    if (typeof cleaned === 'object' && cleaned.visualization_base64) cleaned.visualization_base64 = '(base64 图片，已省略…)';
    if (typeof cleaned === 'object' && cleaned.visualization) cleaned.visualization = '(base64 图片，已省略…)';
    html += `<div class="live-json">${App.formatJsonFull(cleaned)}</div>`;
  }
  if (d.elapsedMs) {
    html += `<hr class="live-divider"><div class="live-row"><span class="live-label">执行耗时</span><span class="live-value">${d.elapsedMs} ms</span></div>`;
  }
  html += '</div>';
  return html;
};

App.renderToolDetail = function(toolName) {
  const t = App.TOOL_STATIC[toolName];
  if (!t) return;
  const toolDetailEl = document.getElementById('tool-detail');
  const liveHtml = App.buildToolLiveHtml(toolName);
  const paramsHtml = t.params.length
    ? t.params.map(p => `<div class="td-param"><span class="td-param-name">${App.escapeHtml(p.name)}</span><span style="color:#484f58;font-size:0.68rem;">${App.escapeHtml(p.type)}</span><span class="td-param-desc">${App.escapeHtml(p.desc)}</span></div>`).join('')
    : '<span style="color:#484f58;font-size:0.76rem;">（不需要参数）</span>';
  const tagsHtml = t.tags.map(tag => `<span class="td-tag">${App.escapeHtml(tag)}</span>`).join(' ');

  toolDetailEl.innerHTML = `
    <div class="tool-detail-header">
      <span class="tool-detail-icon">${t.icon}</span>
      <span class="tool-detail-title">${App.escapeHtml(t.title)}</span>
      <button class="tool-detail-close" id="tool-detail-close">✕</button>
    </div>
    <div style="font-size:0.65rem;color:#79c0ff;font-family:'SF Mono','Fira Code',monospace;margin-bottom:8px;word-break:break-all;">${App.escapeHtml(t.fnName)}</div>
    <div class="tool-detail-body">
      <div class="td-section"><div class="td-label">📖 做什么的？</div>${t.what}</div>
      <div class="td-section"><div class="td-label">💬 说人话</div>${t.human}</div>
      <div class="td-section"><div class="td-label">📥 参数</div>${paramsHtml}</div>
      <div class="td-section"><div class="td-label">📤 返回</div>${App.escapeHtml(t.returns)}</div>
      <div class="td-section"><div class="td-label">🔧 代码</div><div class="td-example">${App.escapeHtml(t.code)}</div></div>
      <div class="td-section"><div class="td-label">🏷️ 概念</div>${tagsHtml}</div>
      ${liveHtml}
    </div>`;
  toolDetailEl.classList.add('show');
  document.getElementById('tool-detail-close').addEventListener('click', (e) => {
    e.stopPropagation();
    toolDetailEl.classList.remove('show');
    App.state.currentDetailTool = null;
  });
  toolDetailEl.scrollTop = 0;
};

App.refreshToolDetailIfOpen = function() {
  if (App.state.currentDetailTool && document.getElementById('tool-detail').classList.contains('show')) {
    App.renderToolDetail(App.state.currentDetailTool);
  }
};

App.initToolboxCards = function() {
  document.querySelectorAll('.tool-card').forEach(el => {
    el.addEventListener('click', () => {
      const tool = el.dataset.tool;
      const toolDetailEl = document.getElementById('tool-detail');
      if (App.state.currentDetailTool === tool) {
        toolDetailEl.classList.remove('show');
        App.state.currentDetailTool = null;
        return;
      }
      App.state.currentDetailTool = tool;
      App.renderToolDetail(tool);
    });
  });
};
