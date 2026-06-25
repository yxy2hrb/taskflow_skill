#!/usr/bin/env node
"use strict";

// run_preprocess.js - pre-process pipeline runner
// Stage0: generate/reuse spec.json page DSL (Qwen VL when missing)
// Stage1: build_div_bbox.js (playwright, no LLM)
// Stage2: Qwen semantic annotation (LLM, text model)
// Stage3: replace_body.py (script)
//
// Usage:
//   node run_preprocess.js <inputDir> [--html <htmlPath>] [--out <outputDir>]
//
// Env:
//   DASHSCOPE_API_KEY or QWEN_API_KEY

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadSkillEnv, configureNodePath, resolveArgPath } = require("../../../scripts/paths");
const {
  callChatCompletions,
  getApiKey,
  getTextModel,
  getVisionModel,
  getModelTemperature,
  getModelSeed,
} = require("../../../scripts/llm_config");

function readUtf8(p) { return fs.readFileSync(p, "utf8"); }
function writeUtf8(p, s) { fs.writeFileSync(p, s, "utf8"); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function extractBlock(html, tag) {
  const re = new RegExp("<" + tag + "\\b[^>]*>[\\s\\S]*?<\\/" + tag + ">", "i");
  const m = html.match(re);
  if (!m) throw new Error("No <" + tag + "> block found");
  return m[0];
}

function tryParseJson(text) {
  // strip markdown code fences
  let clean = text.trim().replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  try { return JSON.parse(clean); } catch(e) {}
  let s = clean.indexOf("["), e2 = clean.lastIndexOf("]");
  if (s !== -1 && e2 > s) { try { return JSON.parse(clean.slice(s, e2 + 1)); } catch(e) {} }
  let s2 = clean.indexOf("{"), e3 = clean.lastIndexOf("}");
  if (s2 !== -1 && e3 > s2) { try { return JSON.parse(clean.slice(s2, e3 + 1)); } catch(e) {} }
  return null;
}

function imageToDataUrl(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase() || "png";
  const mime = ext === "jpg" ? "jpeg" : ext;
  return `data:image/${mime};base64,${buf.toString("base64")}`;
}

async function callDashScopeChat(payload, label) {
  return callChatCompletions(payload, { label });
}

function getChatMessageContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (!item) return "";
      if (typeof item === "string") return item;
      if (typeof item.text === "string") return item.text;
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

async function generateSpecWithQwenVl(imagePath) {
  getApiKey();
  if (!fs.existsSync(imagePath)) throw new Error("spec.json not found and screenshot not found: " + imagePath);

  const specExample = {
    "UI整体描述": "这是一个移动应用的‘我的工作台’页面，主要功能是项目开局管理。页面顶部显示时间、网络状态和电量信息，中间区域展示项目开局的三个操作选项，底部为导航栏，包含五个主要功能入口。",
    "页面构成": [
      "状态栏",
      "标题栏",
      "主内容区",
      "底部导航栏",
    ],
    "视觉风格": "简洁现代，采用灰色背景与白色卡片式设计，图标使用蓝色、橙色、绿色等鲜明色彩突出功能区分，文字清晰易读，整体布局规整，注重功能引导。",
    "各个区域组件信息分述": [
      {
        "组件类型": "状态栏",
        "承担的功能": "显示系统状态信息",
        "承载的信息": "08:08、Wi-Fi信号、蜂窝信号、电池电量100%",
        "组件的配色样式和布局": "位于页面最上方，灰色背景，左侧显示时间，右侧依次排列信号和电量图标",
        "组件所处的位置": "页面顶部",
      },
      {
        "组件类型": "标题栏",
        "承担的功能": "显示当前页面名称及提供交互入口",
        "承载的信息": "我的工作台",
        "组件的配色样式和布局": "黑色字体，右侧有摄像头、消息和机器人头像图标，标题后跟一个向下三角形表示可展开",
        "组件所处的位置": "状态栏下方",
      },
      {
        "组件类型": "卡片容器",
        "承担的功能": "展示项目开局相关操作选项",
        "承载的信息": "项目开局",
        "组件的配色样式和布局": "白色圆角矩形卡片，内含三个并列的按钮，每个按钮包含图标和文字说明",
        "组件所处的位置": "页面中部",
      },
      {
        "组件类型": "功能按钮",
        "承担的功能": "创建开局",
        "承载的信息": "创建开局",
        "组件的配色样式和布局": "蓝色文件夹图标带无线信号，下方为黑色文字，背景为浅灰色圆角矩形",
        "组件所处的位置": "卡片容器内左侧",
      },
      {
        "组件类型": "功能按钮",
        "承担的功能": "创建项目集",
        "承载的信息": "创建项目集",
        "组件的配色样式和布局": "橙色文件夹图标，下方为黑色文字，背景为浅灰色圆角矩形",
        "组件所处的位置": "卡片容器内中间",
      },
      {
        "组件类型": "功能按钮",
        "承担的功能": "接收项目",
        "承载的信息": "接收项目",
        "组件的配色样式和布局": "绿色文档图标带加号，下方为黑色文字，背景为浅灰色圆角矩形",
        "组件所处的位置": "卡片容器内右侧",
      },
      {
        "组件类型": "底部导航栏",
        "承担的功能": "切换不同功能页面",
        "承载的信息": "首页、商城、工作台、服务、我的",
        "组件的配色样式和布局": "五个图标按钮横向排列，当前选中项为红色，其余为灰色，图标下方有对应文字标签",
        "组件所处的位置": "页面底部",
      },
    ],
  };

  const prompt = [
    "请分析这张应用页面截图，输出中文 UI Spec。",
    "输出格式是最高优先级约束，必须严格遵守：",
    "- 只输出一个 JSON 对象本身，必须能被 JSON.parse 直接解析。",
    "- 第一个字符必须是 {，最后一个字符必须是 }。",
    "- 严禁输出 markdown 代码块、```、解释文字、前缀、后缀、注释、自然语言说明或任何 JSON 外字符。",
    "- 严禁输出数组作为根节点，根节点必须是对象。",
    "- 不确定的信息不要编造；承载的信息必须来自截图里真实可见的文案、数字或状态。",
    "JSON 结构必须包含且仅围绕以下字段展开：UI整体描述、页面构成、视觉风格、各个区域组件信息分述。",
    "字段要求：",
    "- 页面构成按从上到下、从左到右列出所有功能区块名。",
    "- 各个区域组件信息分述中列出所有可见核心组件，包含组件类型、承担的功能、承载的信息、组件的配色样式和布局、组件所处的位置。",
    "- 不要写 px、颜色十六进制、代码或实现解释。",
    "参考示例，仅学习结构、粒度和表达方式；不要照抄示例内容，必须根据当前截图生成：",
    JSON.stringify(specExample, null, 2),
  ].join("\n");

  const payload = {
    model: getVisionModel(),
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageToDataUrl(imagePath) } },
          { type: "text", text: prompt },
        ],
      },
    ],
    temperature: getModelTemperature(),
    seed: getModelSeed(),
    max_tokens: 2400,
    response_format: { type: "json_object" },
  };

  const data = await callDashScopeChat(payload, "vision-model");
  const parsed = tryParseJson(getChatMessageContent(data));
  if (!parsed || Array.isArray(parsed)) throw new Error("Vision model returned non-object JSON");
  return parsed;
}

function isLikelyEmptyDiv(bodyHtml, id) {
  if (!id) return false;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("<div[^>]*\\bid=\"" + esc + "\"[^>]*>([\\s\\S]*?)<\\/div>", "i");
  const m = bodyHtml.match(re);
  if (!m) return false;
  return (m[1] || "").replace(/<!--[\s\S]*?-->/g, "").trim().length === 0;
}

function normalizeSemanticItems(parsed) {
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.div_semantic)) return parsed.div_semantic;
  if (parsed.div_semantic && typeof parsed.div_semantic === "object") {
    return Object.entries(parsed.div_semantic).map(([id, value]) => ({ id, ...(value || {}) }));
  }
  if (parsed.annotations && typeof parsed.annotations === "object") {
    return Object.entries(parsed.annotations).map(([id, value]) => ({ id, ...(value || {}) }));
  }
  return [];
}

function bboxToArray(bbox) {
  if (!bbox) return null;
  if (Array.isArray(bbox)) return bbox;
  return [bbox.x, bbox.y, bbox.w, bbox.h];
}

function collectDslTargets(spec) {
  const text = JSON.stringify(spec || {});
  const targets = new Set();
  const known = [
    "顶部状态栏", "状态栏", "标题栏", "顶部导航栏", "底部导航栏",
    "项目开局", "功能图标卡片组", "售后文档", "快速入门", "管理应用",
    "我要参会", "分享获客", "营销物料", "数据统计", "线索", "快捷入口",
    "虚拟体验项目", "项目集", "卡片", "列表", "按钮", "搜索框"
  ];
  for (const item of known) if (text.includes(item)) targets.add(item);
  const regions = spec?.页面构成 || spec?.["页面构成"] || [];
  if (Array.isArray(regions)) regions.forEach((item) => targets.add(String(item)));
  return [...targets].filter(Boolean);
}

function itemText(item) {
  const sem = item.semantic || {};
  return [
    item.id, item.key, item.area, item.range, item.component, item.element, item.text, item.reason,
    sem.area, sem.region, sem.range, sem.semantic, sem.component, sem.element, sem.description,
    typeof sem.text === "string" ? sem.text : "",
    Array.isArray(sem.text_list) ? sem.text_list.join(" ") : "",
  ].filter(Boolean).join(" ");
}

function targetMatched(target, text, activeItems) {
  if (!target) return true;
  if (text.includes(target)) return true;
  if (target === "顶部功能图标") {
    return (activeItems || []).some(function(item) {
      const line = itemText(item);
      return (/顶部|标题栏右侧|状态栏右侧/.test(line) && /功能图标|图标组|icon|视频通话|消息对话|用户头像|状态图标/.test(line)) ||
        /视频通话|消息对话|用户头像/.test(line);
    });
  }
  const synonyms = {
    "标题栏": ["顶部导航栏", "页面标题", "标题", "导航标题"],
    "顶部功能图标": ["功能图标组", "视频通话", "消息对话", "用户头像", "标题栏右侧", "图标"],
    "快捷入口": ["操作入口", "按钮", "创建开局", "创建项目集", "接收项目"],
    "项目开局卡片区域": ["项目开局", "卡片区域", "项目开局相关操作入口"],
  };
  return (synonyms[target] || []).some((word) => text.includes(word));
}

function validateSemanticCoverage(items, spec) {
  const active = items.filter((item) => item && item.use_for_annotation !== false);
  const text = active.map(itemText).join("\n");
  const targets = collectDslTargets(spec);
  const missing = targets.filter((target) => !targetMatched(target, text, active));
  return { targets, missing, ok: missing.length === 0 };
}

function normalizeSemanticForComment(item) {
  const sem = item.semantic || {};
  const textValue = sem.text || item.text || (Array.isArray(sem.text_list) ? sem.text_list.join("/") : "");
  return {
    area: sem.area || sem.region || item.area || "?",
    range: sem.range || item.range || "?",
    semantic: sem.semantic || sem.component || item.semantic_text || item.component || "?",
    text: textValue,
    text_list: sem.text_list || item.text_list || [],
    description: sem.description || item.description || "",
  };
}

function bboxContains(parent, child) {
  if (!parent || !child) return false;
  return parent.x <= child.x && parent.y <= child.y &&
    parent.x + parent.w >= child.x + child.w &&
    parent.y + parent.h >= child.y + child.h &&
    (parent.w * parent.h) > (child.w * child.h);
}

function refineOverlappingSemantics(items) {
  const out = items.map((item) => ({ ...item, semantic: { ...(item.semantic || {}) } }));
  for (const parent of out) {
    if (!parent || parent.use_for_annotation === false || !parent.bbox || !parent.semantic) continue;
    const parentComponent = parent.semantic.semantic || parent.semantic.component;
    if (!parentComponent || /聚合容器|背景|装饰|未细分/.test(parentComponent)) continue;
    const duplicateChild = out.find((child) =>
      child && child !== parent && child.use_for_annotation !== false &&
      child.bbox && child.semantic && (child.semantic.semantic || child.semantic.component) === parentComponent &&
      bboxContains(parent.bbox, child.bbox)
    );
    if (!duplicateChild) continue;
    parent.semantic.semantic = parentComponent + "聚合容器";
    parent.confidence = parent.confidence === "高" ? "中" : parent.confidence;
    parent.reason = (parent.reason || "") + " 已由脚本后处理避免父子重复标注同一语义。";
  }
  return out;
}

async function callSemanticAnnotator(prompt) {
  const payload = {
    model: getTextModel(),
    messages: [{ role: "user", content: prompt }],
    temperature: getModelTemperature(),
    seed: getModelSeed(),
    max_tokens: 12000,
    response_format: { type: "json_object" },
  };
  const data = await callDashScopeChat(payload, "text-model");
  const txt = getChatMessageContent(data);
  if (!txt) throw new Error("Text model returned no content");
  return txt;
}

function annotateBodySemantic(bodyHtml, semanticItems) {
  let out = bodyHtml;
  for (const item of semanticItems) {
    if (!item || item.use_for_annotation === false) continue;
    const id = item.id;
    if (!id) continue;
    const sem = normalizeSemanticForComment(item);
    const bboxArr = bboxToArray(item.bbox) || bboxToArray(sem.bbox);
    const bboxStr = bboxArr ? bboxArr.join(",") : "?";
    const parts = [
      "area=" + (sem.area || "?"),
      "range=" + (sem.range || "?"),
      "semantic=" + (sem.semantic || "?"),
    ];
    if (sem.text) parts.push("text=" + sem.text);
    else if (Array.isArray(sem.text_list) && sem.text_list.length) parts.push("text=" + sem.text_list.join("/"));
    if (sem.description) parts.push("desc=" + sem.description);
    if (item.semantic?.icon_hint) parts.push("icon=" + item.semantic.icon_hint);
    if (item.semantic?.function_hint) parts.push("func=" + item.semantic.function_hint);
    parts.push("bbox=" + bboxStr);
    parts.push("confidence=" + (item.confidence || "medium"));
    const comment = "<!-- semantic: " + parts.join(" | ") + " -->";
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(<div[^>]+\\bid=\"" + esc + "\"[^>]*>)", "i");
    if (re.test(out)) out = out.replace(re, comment + "\n$1");
  }
  return out;
}

function isOverlayLikeBboxItem(item) {
  if (!item || !item.id || !item.bbox) return false;
  const bbox = item.bbox || {};
  const w = Number(bbox.w || 0);
  const h = Number(bbox.h || 0);
  const x = Number(bbox.x || 0);
  const y = Number(bbox.y || 0);
  const style = item.style_summary || {};
  const background = String(style.background || "");
  const hasNoContent = !String(item.text_snippet || "").trim() &&
    !((item.direct_texts || []).join("").trim()) &&
    Number(item.child_div_count || 0) === 0 &&
    Number(item.total_child_count || 0) === 0;
  const coversViewport = x <= 1 && y <= 1 && w >= 300 && h >= 600;
  const isDimLayer = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.[1-9]/i.test(background);
  return hasNoContent && coversViewport && isDimLayer;
}

function removeMaskAnnotatedDivs(bodyHtml, semanticItems, bboxItems) {
  const maskIds = new Set();
  for (const item of semanticItems) {
    if (!item || item.use_for_annotation === false || !item.id) continue;
    const sem = normalizeSemanticForComment(item);
    const semanticText = [sem.area, sem.range, sem.semantic].filter(Boolean).join(" ");
    if (/mask|遮罩|蒙层|fullscreen-mask|top-area-mask|overlay/i.test(semanticText)) {
      maskIds.add(item.id);
    }
  }
  for (const item of bboxItems || []) {
    if (isOverlayLikeBboxItem(item)) maskIds.add(item.id);
  }
  let out = bodyHtml;
  for (const id of maskIds) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\s*<!--\\s*semantic:[^>]*-->\\s*\\n?\\s*<!--\\s*bbox:[^>]*-->\\s*\\n?\\s*<div[^>]*\\bid="${esc}"[^>]*>\\s*<\\/div>`, "gi");
    out = out.replace(re, "");
    const re2 = new RegExp(`\\s*<!--\\s*bbox:[^>]*-->\\s*\\n?\\s*<div[^>]*\\bid="${esc}"[^>]*>\\s*<\\/div>`, "gi");
    out = out.replace(re2, "");
    const re3 = new RegExp(`\\s*<div[^>]*\\bid="${esc}"[^>]*>\\s*<\\/div>`, "gi");
    out = out.replace(re3, "");
  }
  return out;
}

async function main() {
  loadSkillEnv();
  configureNodePath();
  const args = process.argv.slice(2);
  const cwd = process.cwd();
  let inputDir = null, htmlPathArg = null, imagePathArg = null, outputDirArg = null;
  let widthArg = null, heightArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--html")        { htmlPathArg  = args[++i]; }
    else if (args[i] === "--image")  { imagePathArg = args[++i]; }
    else if (args[i] === "--out")    { outputDirArg = args[++i]; }
    else if (args[i] === "--width")  { widthArg     = args[++i]; }
    else if (args[i] === "--height") { heightArg    = args[++i]; }
    else if (!inputDir) { inputDir = args[i]; }
  }
  if (!inputDir) {
    console.error("Usage: node run_preprocess.js <inputDir> [--html <path>] [--image <pngPath>] [--out <dir>] [--width W] [--height H]");
    process.exit(1);
  }

  inputDir = resolveArgPath(inputDir, cwd);
  const htmlPath = htmlPathArg ? resolveArgPath(htmlPathArg, cwd) : path.join(inputDir, "html", "Index.original.html");
  const specPath = path.join(inputDir, "spec.json");
  const imagePath = imagePathArg ? resolveArgPath(imagePathArg, cwd) : path.join(inputDir, "wps_doc_0.png");
  const bboxDir = path.join(inputDir, ".result_bbox");
  const outputDir = outputDirArg ? resolveArgPath(outputDirArg, cwd) : path.join(inputDir, ".preprocess");
  ensureDir(outputDir);

  let apiKey = null;
  try {
    loadSkillEnv();
    apiKey = getApiKey();
  } catch (_) {
    console.warn("  [WARN] no DASHSCOPE_API_KEY - Stage0/Stage2 LLM calls may be skipped or fail");
  }

  const viewportW = widthArg || "360";
  const viewportH = heightArg || "792";
  let specSource = "existing";
  let spec = null;
  if (fs.existsSync(specPath)) {
    try {
      spec = JSON.parse(readUtf8(specPath));
      console.log("\n[Stage 0] reuse existing spec.json");
    } catch (err) {
      const invalidSpec = readUtf8(specPath);
      writeUtf8(path.join(outputDir, "spec.invalid.txt"), invalidSpec);
      console.warn("\n[Stage 0] existing spec.json is invalid JSON; regenerating from screenshot");
      spec = await generateSpecWithQwenVl(imagePath);
      writeUtf8(specPath, JSON.stringify(spec, null, 2));
      writeUtf8(path.join(outputDir, "spec.generated.json"), JSON.stringify(spec, null, 2));
      specSource = getVisionModel();
      console.log("[Stage 0] regenerated -> " + specPath);
    }
  } else {
    console.log("\n[Stage 0] spec.json missing, generating from screenshot with vision model ...");
    spec = await generateSpecWithQwenVl(imagePath);
    writeUtf8(specPath, JSON.stringify(spec, null, 2));
    writeUtf8(path.join(outputDir, "spec.generated.json"), JSON.stringify(spec, null, 2));
    specSource = getVisionModel();
    console.log("[Stage 0] done -> " + specPath);
  }
  writeUtf8(path.join(outputDir, "spec.used.json"), JSON.stringify(spec, null, 2));

  let bboxJson = null;
  let annotatedBodyBboxPath = null;
  let annotatedBodySemantic = null;
  let semanticSource = "skipped";
  let semanticItems = [];
  let semanticValidation = { targets: [], missing: [], ok: false };
  let stageAttempts = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const attemptDir = attempt === 0 ? bboxDir : path.join(inputDir, ".result_bbox_retry_" + (attempt + 1));
    const depthArgs = attempt === 0 ? [] : ["--depth", String((bboxJson?.report?.adaptive_depth?.selected_depth || bboxJson?.__selectedDepth || 1) + 1)];

    console.log("\n[Stage 1] running build_div_bbox.js (attempt " + (attempt + 1) + ") ...");
    const s1args = [BUILD_BBOX_SCRIPT, inputDir, "--html", htmlPath, "--out", attemptDir, "--width", viewportW, "--height", viewportH, "--target-ratio", "0.6"].concat(depthArgs);
    const stage1 = spawnSync("node", s1args, { encoding: "utf8", stdio: "inherit" });
    if (stage1.status !== 0) throw new Error("Stage 1 failed");

    bboxJson = JSON.parse(readUtf8(path.join(attemptDir, "div_bbox.json")));
    const stage1Report = JSON.parse(readUtf8(path.join(attemptDir, "report.json")));
    bboxJson.report = stage1Report;
    bboxJson.__selectedDepth = stage1Report.adaptive_depth && stage1Report.adaptive_depth.selected_depth;
    annotatedBodyBboxPath = path.join(attemptDir, "annotated_body_bbox.html");
    const annotatedBodyBbox = readUtf8(annotatedBodyBboxPath);
    console.log("[Stage 1] done, bbox count: " + (bboxJson.div_bbox || []).length);

    annotatedBodySemantic = annotatedBodyBbox;
    if (!apiKey) break;

    console.log("\n[Stage 2] calling text model for semantic annotation (attempt " + (attempt + 1) + ") ...");
    const divBbox = bboxJson.div_bbox || [];
    const body = extractBlock(readUtf8(htmlPath), "body");
    const divsInfo = divBbox.map(function(d) {
      return {
        key: d.key, id: d.id,
        bbox: d.bbox,
        is_empty_div: isLikelyEmptyDiv(body, d.id),
        text_snippet: d.text_snippet || "",
        total_child_count: d.total_child_count || 0,
        style_summary: {
          background: d.style_summary?.background || "",
          boxShadow: d.style_summary?.boxShadow || "",
          opacity: d.style_summary?.opacity || "",
        },
      };
    });

    const prompt = [
      "You are a semantic annotator for mobile UI HTML. Return JSON only.",
      "Input: DSL, div bbox list, and body HTML with bbox comments for context.",
      "Core rules:",
      "  - bbox is HARD constraint: top bbox cannot be labeled bottom-nav; bottom bbox cannot be labeled top-nav.",
      "  - STRICTLY FORBIDDEN to annotate based on bbox position alone. You MUST also examine: (1) text_snippet - visible text inside the div, match against DSL descriptions (e.g. '8:08' matches status-bar time, tab labels match bottom-nav items); (2) child_div_count and total_child_count - zero children with large area suggests mask/background; multiple children with icons/labels suggests nav or card group.",
      "  - Annotate only meaningful divs: masks, backgrounds, regions/components/icons mentioned by DSL, and divs whose semantic confidence is medium or high.",
      "  - Do NOT annotate just to reach a percentage. There is no requirement to annotate 60% of all divs.",
      "  - For each meaningful region/component you annotate, also inspect its child div structure and annotate 2-4 key child nodes when confidence is medium/high: title text container, each important card/button entry, key icon group, mask/background layer.",
      "  - Example: if a card region contains three action cards/buttons, annotate the card region plus the three child card/button containers when their bbox/text/child structure supports them.",
      "  - Do not annotate every decorative vector. Only annotate icon groups or child containers that represent a meaningful UI object.",
      "  - IMPORTANT: If DSL mentions icon or 功能图标, you MUST annotate the best matching icon container even when text_snippet is empty. Use bbox location, class names, child_div_count, and nearby title/status context. For example, an empty top-right div with several child vectors/icons can be semantic='顶部功能图标组' with text=''.",
      "  - If DSL says 顶部功能图标, it means icons in the top/title/status area, usually right of the title or status bar. Do NOT satisfy this with bottom navigation icons.",
      "  - Empty text does not mean meaningless. Empty divs with vector/group children may be icons, while empty large rectangles may be background or mask.",
      "  - Use style_summary to identify background/mask: large bbox, empty text, rectangle/vector class, background color, opacity, pointer-events, z-index, overlay-like size. Annotate high/medium confidence background and mask nodes explicitly.",
      "  - Avoid ambiguous/overlapping semantics. If a parent div contains both status-bar time and navigation title/buttons, semantic MUST be a combined natural-language semantic such as '顶部状态栏+顶部导航栏', not just '状态栏'. If a child div is the pure status bar, only the child can be '顶部状态栏'.",
      "  - Do not mark both a parent and a child as the exact same semantic unless the parent is a broader aggregation and the child is a specific subpart.",
      "  - Reasoning order: first read text_snippet and child counts, form a hypothesis about what the div IS, then verify with bbox. If text/child evidence contradicts bbox-based assumption, trust text/child evidence.",
      "  - If a div has no children (child_div_count=0, total_child_count=0) and occupies large area, it is likely background/mask/overlay, NOT a navigation bar or card.",
      "  - For each annotated div, semantic fields MUST use Chinese natural-language descriptions: area, range, semantic, text, bbox, confidence.",
      "  - area: which broad page area it belongs to, such as 顶部区域/主体内容区域/底部区域/全屏背景.",
      "  - range: judge by the frame bbox in the provided mobile viewport, such as 整个页面/上半部分/顶部靠右/中间靠左/底部横向区域.",
      "  - semantic: natural-language description of its meaning, which may be a region, component, icon, mask, background, button group, etc.",
      "  - text: visible text contained in this div. Use an empty string if no visible text.",
      "  - Do not output element. Do not force every div to have a fine-grained element label.",
      "  - For DSL-mentioned components/areas, find the most suitable div. If no suitable div exists in this candidate list, set needs_deeper_depth=true for that target in coverage_check.",
      "  - If a div occupies significant area but is_empty_div=true, label it as a mask (fullscreen-mask, top-area-mask, etc) with use_for_annotation=true. Explain in reason.",
      "  - Only set use_for_annotation=false when bbox data is missing or the div has zero visible size.",
      "  - Never invent key/id values not in the provided divs list.",
      "  - Do NOT output HTML. Output div id + semantic annotation pairs only.",
      "Output strict JSON only:",
      '{ "div_semantic": [{"key":"...","id":"...","use_for_annotation":true,"confidence":"高|中","semantic":{"area":"中文区域描述","range":"中文范围描述","semantic":"中文自然语言语义，可为区域/组件/icon/mask/背景等","text":"可见文本","bbox":[0,0,0,0]},"bbox":{"x":0,"y":0,"w":0,"h":0},"reason":"中文依据"}], "coverage_check":{"needs_deeper_depth":false,"missing_targets":["..."]} }',
      "dsl=" + JSON.stringify(spec),
      "divs=" + JSON.stringify(divsInfo),
      "body_with_bbox=" + annotatedBodyBbox,
    ].join("\n");

    try {
      const txt = await callSemanticAnnotator(prompt);
      writeUtf8(path.join(outputDir, "semantic.attempt" + (attempt + 1) + ".raw.txt"), txt);
      const parsed = tryParseJson(txt);
      const normalizedItems = normalizeSemanticItems(parsed);
      if (normalizedItems.length > 0) {
        const coveredItems = refineOverlappingSemantics(normalizedItems.filter(function(item) {
          return item && item.use_for_annotation !== false;
        }));
        const normalized = { div_semantic: coveredItems, coverage_check: parsed.coverage_check || null };
        writeUtf8(path.join(outputDir, "div_semantic.attempt" + (attempt + 1) + ".json"), JSON.stringify(normalized, null, 2));
        semanticValidation = validateSemanticCoverage(coveredItems, spec);
        semanticItems = coveredItems;
        annotatedBodySemantic = removeMaskAnnotatedDivs(annotateBodySemantic(annotatedBodyBbox, coveredItems), coveredItems, divBbox);
        semanticSource = getTextModel();
        const cnt = coveredItems.filter(function(x) { return x.use_for_annotation !== false; }).length;
        stageAttempts.push({ attempt: attempt + 1, bboxDir: attemptDir, annotated: cnt, validation: semanticValidation, coverage_check: normalized.coverage_check });
        console.log("[Stage 2] done, annotated divs: " + cnt + ", missing targets: " + semanticValidation.missing.join(","));
        if (cnt >= 3) break;
        if (attempt === 2) break;
        console.warn("[Stage 2] annotated div count < 3, retrying with depth+1 ...");
      } else {
        console.warn("[Stage 2] could not parse model output, skipping");
        stageAttempts.push({ attempt: attempt + 1, bboxDir: attemptDir, error: "parse_failed" });
        if (attempt === 2) break;
      }
    } catch(e) {
      console.warn("[Stage 2] semantic annotation failed: " + e.message);
      stageAttempts.push({ attempt: attempt + 1, bboxDir: attemptDir, error: e.message });
      if (attempt === 2) break;
    }
  }
  if (!annotatedBodySemantic && annotatedBodyBboxPath) annotatedBodySemantic = readUtf8(annotatedBodyBboxPath);
  writeUtf8(path.join(outputDir, "div_semantic.json"), JSON.stringify({ div_semantic: semanticItems, validation: semanticValidation }, null, 2));

  const annotatedBodySemanticPath = path.join(outputDir, "annotated_body_semantic.html");
  writeUtf8(annotatedBodySemanticPath, annotatedBodySemantic);

  // Stage 3: body replace
  console.log("\n[Stage 3] running replace_body.py ...");
  const outputHtmlPath = path.join(outputDir, "Index.preprocessed.html");
  const py = spawnSync("python", [
    REPLACE_BODY_SCRIPT, "--target", htmlPath, "--body", annotatedBodySemanticPath, "--out", outputHtmlPath
  ], { encoding: "utf8" });
  if (py.status !== 0) throw new Error("replace_body.py failed: " + (py.stderr || py.stdout));
  console.log("[Stage 3] done -> " + outputHtmlPath);

  const report = {
    ok: true,
    input: { inputDir, htmlPath, specPath },
    stages: {
      stage0_spec: {
        source: specSource,
        imagePath,
        specPath,
        generated: specSource !== "existing",
      },
      stage1_bbox: {
        source: "playwright",
        bboxCount: (bboxJson.div_bbox || []).length,
        adaptiveDepth: bboxJson.report && bboxJson.report.adaptive_depth,
      },
      stage2_semantic: {
        source: semanticSource,
        attempts: stageAttempts,
        validation: semanticValidation,
        annotatedCount: semanticItems.filter(function(x) { return x && x.use_for_annotation !== false; }).length,
      },
      stage3_replace: { ok: true },
    },
    outputs: {
      annotated_body_bbox: annotatedBodyBboxPath,
      annotated_body_semantic: annotatedBodySemanticPath,
      spec_used: path.join(outputDir, "spec.used.json"),
      spec_generated: specSource !== "existing" ? path.join(outputDir, "spec.generated.json") : null,
      output_html: outputHtmlPath,
    },
  };
  writeUtf8(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  console.log("\n=== done ===");
  console.log("  output_dir : " + outputDir);
  console.log("  output_html: " + outputHtmlPath);
}

main().catch(function(e) { console.error("[ERROR] " + e.message + "\n" + e.stack); process.exit(1); });
