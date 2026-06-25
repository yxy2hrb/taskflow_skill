#!/usr/bin/env node
"use strict";
/**
 * 阶段1自动化脚本：div 树提取 + Playwright 真实 bbox 标注
 *
 * 完全不使用 LLM。流程：
 *   1. 解析 HTML，提取全部 div 及其嵌套深度
 *   2. 自适应深度选择：最小深度 d，使 depth<=d 的 div 数 > 60% 总数
 *   3. 向 HTML 注入临时 data-_bbox_key 标记，用 Playwright 渲染
 *   4. 通过 getBoundingClientRect() 获取每个 div 的真实像素坐标
 *   5. 在原始 body 中插入 <!-- bbox: key=... | x=... y=... w=... h=... --> 注释
 *   6. 输出 div_bbox.json / annotated_body_bbox.html / report.json
 *
 * 用法：
 *   node build_div_bbox.js <inputDir>
 *
 * 输入目录约定（inputDir）：
 *   html/Index.original.html  —— 源 HTML
 *   wps_doc_0.png             —— 截图（仅用于读取 viewport 尺寸，可选）
 *
 * 输出目录：inputDir/.result_bbox/
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function readUtf8(p) { return fs.readFileSync(p, "utf8"); }
function writeUtf8(p, s) { fs.writeFileSync(p, s, "utf8"); }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function pngSize(pngPath) {
  try {
    const b = fs.readFileSync(pngPath);
    if (b.length < 24 || b.toString("ascii", 1, 4) !== "PNG") return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } catch { return null; }
}

function extractBlock(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i"));
  if (!m) throw new Error(`No <${tag}>...</${tag}> block found.`);
  return m[0];
}

function parseAttrs(attrText) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrText))) attrs[m[1]] = m[2];
  return attrs;
}

function parseDivTree(bodyHtml) {
  const tokenRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  const stack = [];
  const all = [];
  let m;
  let autoIdx = 1;
  while ((m = tokenRe.exec(bodyHtml))) {
    const full = m[0];
    const tag = m[1].toLowerCase();
    const attrText = m[2] || "";
    const closing = full.startsWith("</");
    if (closing) { if (stack.length) stack.pop(); continue; }
    const selfClose = full.endsWith("/>");
    if (tag === "div") {
      const attrs = parseAttrs(attrText);
      const depth = stack.length + 1;
      const id = attrs.id || null;
      const classText = attrs.class || "";
      const classes = classText.split(/\s+/).filter(Boolean);
      const key = id ? `id:${id}` : `auto:${autoIdx++}`;
      const parentKey = stack.length ? stack[stack.length - 1].key : null;
      const node = { key, id, classes, depth, parentKey, openingTag: full };
      all.push(node);
      if (!selfClose) stack.push(node);
    } else if (!selfClose) {
      stack.push({ key: `_tag:${tag}` });
    }
  }
  return all;
}

function chooseAdaptiveDepth(allDivs, ratio, forcedDepth) {
  ratio = ratio || 0.6;
  const total = allDivs.length;
  if (!total) return { depth: 1, coverage: 0, total: 0, selected: 0 };
  const depthCount = new Map();
  for (const d of allDivs) depthCount.set(d.depth, (depthCount.get(d.depth) || 0) + 1);
  const depthLevels = [...depthCount.keys()].sort((a, b) => a - b);
  if (forcedDepth) {
    const selected = allDivs.filter((d) => d.depth <= forcedDepth).length;
    return { depth: forcedDepth, coverage: selected / total, total, selected };
  }
  let cumulative = 0;
  let chosen = depthLevels[depthLevels.length - 1];
  for (const dep of depthLevels) {
    cumulative += depthCount.get(dep) || 0;
    if (cumulative / total > ratio) { chosen = dep; break; }
  }
  return { depth: chosen, coverage: cumulative / total, total, selected: cumulative };
}

function injectBboxKeys(html, selectedDivs) {
  let out = html;
  for (const div of selectedDivs) {
    const escaped = div.openingTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped);
    if (re.test(out)) {
      const patched = div.openingTag.replace(/>$/, ` data-_bbox_key="${div.key}">`);
      out = out.replace(re, patched);
    }
  }
  return out;
}

async function getBboxViaPlaywright(htmlContent, viewport) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle" });
    const rects = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll("[data-_bbox_key]").forEach((el) => {
        const key = el.getAttribute("data-_bbox_key");
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const directTexts = Array.from(el.children)
          .filter((child) => !String(child.tagName || "").match(/^DIV$/i))
          .map((child) => (child.innerText || child.textContent || "").trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .slice(0, 8);
        const directChildKeys = Array.from(el.children)
          .map((child) => child.getAttribute && child.getAttribute("data-_bbox_key"))
          .filter(Boolean);
        const styleSummary = {
          opacity: cs.opacity,
          background: cs.backgroundColor,
          boxShadow: cs.boxShadow === "none" ? "" : cs.boxShadow,
        };
        results.push({
          key,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          visible: r.width > 0 && r.height > 0,
          text_snippet: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
          direct_texts: directTexts,
          child_div_count: el.querySelectorAll(":scope > div").length,
          total_child_count: el.children.length,
          direct_child_keys: directChildKeys,
          style_summary: styleSummary,
        });
      });
      return results;
    });
    return rects;
  } finally {
    await browser.close();
  }
}

function annotateBodyWithBbox(bodyHtml, bboxRects) {
  let out = bodyHtml;
  for (const item of bboxRects) {
    if (!item.visible) continue;
    const { key, x, y, w, h } = item;
    const comment = `<!-- bbox: key=${key} | x=${x} y=${y} w=${w} h=${h} -->`;
    const idMatch = key.match(/^id:(.+)$/);
    if (idMatch) {
      const id = idMatch[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(<div[^>]+\\bid="${id}"[^>]*>)`, "i");
      if (re.test(out)) { out = out.replace(re, `${comment}\n$1`); continue; }
    }
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reKey = new RegExp(`(<div[^>]+\\bdata-_bbox_key="${escapedKey}"[^>]*>)`, "i");
    if (reKey.test(out)) { out = out.replace(reKey, `${comment}\n$1`); }
  }
  return out;
}

async function main() {
  // 解析参数：node build_div_bbox.js <inputDir> [--html <htmlPath>] [--out <resultDir>] [--width W] [--height H] [--target-ratio R] [--depth D]
  const args = process.argv.slice(2);
  let inputDir = null;
  let htmlPathOverride = null;
  let resultDirOverride = null;
  let widthOverride = null;
  let heightOverride = null;
  let targetRatio = 0.6;
  let forcedDepth = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--html")   { htmlPathOverride  = args[++i]; }
    else if (args[i] === "--out")    { resultDirOverride = args[++i]; }
    else if (args[i] === "--width")  { widthOverride     = parseInt(args[++i], 10); }
    else if (args[i] === "--height") { heightOverride    = parseInt(args[++i], 10); }
    else if (args[i] === "--target-ratio") { targetRatio = Number(args[++i]); }
    else if (args[i] === "--depth") { forcedDepth = parseInt(args[++i], 10); }
    else if (!inputDir) { inputDir = args[i]; }
  }
  if (!inputDir) {
    throw new Error("Usage: node build_div_bbox.js <inputDir> [--html <path>] [--out <dir>] [--width W] [--height H]");
  }
  const htmlPath = htmlPathOverride || path.join(inputDir, "html", "Index.original.html");
  const imagePath = path.join(inputDir, "wps_doc_0.png");
  const resultDir = resultDirOverride || path.join(inputDir, ".result_bbox");
  ensureDir(resultDir);

  console.log(`[build_div_bbox] inputDir: ${inputDir}`);
  const html = readUtf8(htmlPath);
  const body = extractBlock(html, "body");

  const allDivs = parseDivTree(body);
  const adaptive = chooseAdaptiveDepth(allDivs, targetRatio, forcedDepth);
  const selectedDivs = allDivs.filter((d) => d.depth <= adaptive.depth);

  console.log(`[build_div_bbox] total=${allDivs.length}, depth=${adaptive.depth}, coverage=${(adaptive.coverage * 100).toFixed(1)}%, selected=${selectedDivs.length}`);
  writeUtf8(path.join(resultDir, "divs.all.json"), JSON.stringify(allDivs, null, 2));
  writeUtf8(path.join(resultDir, "divs.selected.json"), JSON.stringify(selectedDivs, null, 2));

  const markedHtml = injectBboxKeys(html, selectedDivs);

  // 任务流统一手机视口 360×792；仅 --width/--height 可覆盖，不再从 PNG 外框读取
  const DEFAULT_VIEWPORT = { width: 360, height: 792 };
  const viewport = {
    width: widthOverride || DEFAULT_VIEWPORT.width,
    height: heightOverride || DEFAULT_VIEWPORT.height,
  };
  console.log(`[build_div_bbox] viewport: ${viewport.width}x${viewport.height}`);

  console.log(`[build_div_bbox] launching Playwright...`);
  const bboxRects = await getBboxViaPlaywright(markedHtml, viewport);
  console.log(`[build_div_bbox] got ${bboxRects.length} rects, visible=${bboxRects.filter(r=>r.visible).length}`);

  const bboxMap = new Map(bboxRects.map((r) => [r.key, r]));
  const divBbox = selectedDivs.map((div) => {
    const rect = bboxMap.get(div.key);
    if (rect) return {
      key: div.key,
      id: div.id,
      bbox: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
      text_snippet: rect.text_snippet || "",
      total_child_count: rect.total_child_count || 0,
      style_summary: {
        background: rect.style_summary?.background || "",
        boxShadow: rect.style_summary?.boxShadow || "",
        opacity: rect.style_summary?.opacity || "",
      },
    };
    return {
      key: div.key,
      id: div.id,
      bbox: null,
      text_snippet: "",
      total_child_count: 0,
      style_summary: { background: "", boxShadow: "", opacity: "" },
    };
  });
  writeUtf8(path.join(resultDir, "div_bbox.json"), JSON.stringify({ div_bbox: divBbox }, null, 2));

  const annotatedBody = annotateBodyWithBbox(body, bboxRects);
  const annotatedBodyPath = path.join(resultDir, "annotated_body_bbox.html");
  writeUtf8(annotatedBodyPath, annotatedBody);

  const report = {
    ok: true, stage: 1, method: "playwright-getBoundingClientRect",
    input: { inputDir, htmlPath, imagePath },
    adaptive_depth: {
      target_ratio: targetRatio,
      selected_depth: adaptive.depth,
      forced_depth: forcedDepth,
      coverage_ratio: Number(adaptive.coverage.toFixed(4)),
      total_div_count: adaptive.total,
      selected_div_count: adaptive.selected,
    },
    viewport,
    counts: {
      all_divs: allDivs.length,
      selected_divs: selectedDivs.length,
      bbox_visible: bboxRects.filter((r) => r.visible).length,
      bbox_invisible: bboxRects.filter((r) => !r.visible).length,
      annotated_count: (annotatedBody.match(/<!-- bbox:/g) || []).length,
    },
    outputs: {
      divs_all: path.join(resultDir, "divs.all.json"),
      divs_selected: path.join(resultDir, "divs.selected.json"),
      div_bbox: path.join(resultDir, "div_bbox.json"),
      annotated_body_bbox: annotatedBodyPath,
      report: path.join(resultDir, "report.json"),
    },
  };
  writeUtf8(path.join(resultDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`[OK] stage1 done -> ${resultDir}`);
}

main().catch((e) => { console.error(`[ERROR] ${e.message}\n${e.stack}`); process.exit(1); });
