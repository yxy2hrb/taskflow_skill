#!/usr/bin/env node


"use strict";





const fs = require("fs");


const path = require("path");





function readUtf8(file) {


  return fs.readFileSync(file, "utf8");


}





function writeUtf8(file, text) {


  fs.mkdirSync(path.dirname(file), { recursive: true });


  fs.writeFileSync(file, text, "utf8");


}





function argValue(args, name, fallback) {


  const idx = args.indexOf(name);


  return idx >= 0 ? args[idx + 1] : fallback;


}





function parseSemanticComment(text) {


  const out = {};


  for (const part of String(text || "").split("|")) {


    const idx = part.indexOf("=");


    if (idx < 0) continue;


    const key = part.slice(0, idx).trim();


    const value = part.slice(idx + 1).trim();


    out[key] = value;


  }


  if (out.bbox && out.bbox !== "?") {


    const nums = out.bbox.split(",").map(Number);


    if (nums.length === 4 && nums.every(Number.isFinite)) out.bbox = nums;


  }


  return out;


}





function slugify(text) {


  const raw = String(text || "").trim();

  return raw
    .replace(/[?#]/g, "")
    .replace(/[\s_/]+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")
    .replace(/^-+|-+$/g, "") || "anchor";


  const map = [


    [/bottom.*nav|底部.*导航|导航栏.*底部/i, "bottom-nav"],


    [/status.*bar|状态栏/i, "status-bar"],


    [/title.*bar|top.*app.*bar|标题栏|顶部.*导航/i, "top-app-bar"],


    [/main.*content|主体|内容区/i, "main-content"],


    [/card.*area|卡片区域|project-card|项目.*卡片/i, "project-card"],


    [/project.*buttons|项目.*按钮|button.*group/i, "project-buttons"],


    [/mask|background|背景|遮罩/i, "mask"],


    [/icon/i, "icon"],


  ];


  for (const [re, value] of map) {


    if (re.test(raw)) return value;


  }


  return raw


    .replace(/[?#]/g, "")


    .replace(/[\s_/]+/g, "-")


    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")


    .replace(/^-+|-+$/g, "") || "anchor";


}





function inferAnchorName(semantic, id, text) {


  const area = semantic.area || "";


  const component = semantic.component || semantic.semantic || "";


  const element = semantic.element || semantic.range || "";


  const textValue = String(text || "").trim();


  let base = slugify(component !== "?" ? component : area);


  if (element && element !== "?") {


    const elementSlug = slugify(element);


    if (elementSlug && !base.includes(elementSlug)) base += "-" + elementSlug;


  }


  if (/底部导航栏/.test(base) && textValue) {


    const labels = {


      "我的": "my",


      "服务": "service",


      "工作台": "workbench",


      "商城": "mall",


      "首页": "home",


    };


    if (labels[textValue]) return `底部导航栏-${textValue}`;


  }


  if (/遮罩|背景/.test(base) && /底部/.test(area)) return "底部导航栏遮罩";


  if (!base || base === "anchor") return id ? `node-${id}` : "anchor";


  return base;


}





function textAnchorName(text, bbox, parentSemantic) {


  const labels = {


    "我的": "底部导航栏-我的",


    "服务": "底部导航栏-服务",


    "工作台": "底部导航栏-工作台",


    "商城": "底部导航栏-商城",


    "首页": "底部导航栏-首页",


    "创建项目集": "创建项目集-文本",


    "创建开局": "创建开局-文本",


    "接收项目": "接收项目-文本",


    "我的体验项目": "我的体验项目-文本",


    "体验开局流程": "体验开局流程-文本",


    "体验运维流程": "体验运维流程-文本",


  };


  if (parentSemantic && labels[text]) {
    const parentPrefix = slugify(parentSemantic.component || parentSemantic.semantic || parentSemantic.area || "");
    if (parentPrefix && parentPrefix !== "anchor") return `${parentPrefix}-文本-${text}`;
  }

  if (labels[text]) return labels[text];


  return slugify(text) + "-文本";


}





function inferInheritancePolicy(semantic) {


  const area = semantic.area || "";


  const component = semantic.component || semantic.semantic || "";


  const element = semantic.element || semantic.range || "";


  const text = `${area} ${component} ${element}`;


  if (/bottom.*nav|底部.*导航|status.*bar|状态栏|title.*bar|标题栏|top.*app.*bar/i.test(text)) {


    return "persistent-or-hideable";


  }


  if (/mask|background|背景|遮罩/i.test(text)) return "hideable";


  if (/card|content|主体|表单|列表|按钮区|项目/i.test(text)) return "replaceable";


  return "hideable";


}





function extractInnerText(html) {


  return String(html || "")


    .replace(/<script[\s\S]*?<\/script>/gi, "")


    .replace(/<style[\s\S]*?<\/style>/gi, "")


    .replace(/<[^>]+>/g, " ")


    .replace(/\s+/g, " ")


    .trim();


}





function parseRegistryFromAnnotatedHtml(html) {


  const entries = [];


  const re = /<!--\s*semantic:\s*([\s\S]*?)\s*-->\s*(<([a-zA-Z][\w:-]*)\b([^>]*)>)/g;


  let match;


  while ((match = re.exec(html))) {


    const semantic = parseSemanticComment(match[1]);


    const openTag = match[2];


    const tag = match[3].toLowerCase();


    const attrs = match[4] || "";


    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);


    const id = idMatch && idMatch[1];


    if (!id) continue;


    const endTag = new RegExp(`</${tag}>`, "ig");


    endTag.lastIndex = re.lastIndex;


    const end = endTag.exec(html);


    const htmlSlice = end ? html.slice(match.index, end.index + end[0].length) : openTag;


    const text = extractInnerText(htmlSlice).slice(0, 80);


    const name = inferAnchorName(semantic, id, text);


    entries.push({


      name,


      selector: `#${id}`,


      id,


      area: semantic.area || "?",


      component: semantic.component || semantic.semantic || "?",


      element: semantic.element || semantic.range || "?",


      bbox: Array.isArray(semantic.bbox) ? semantic.bbox : null,


      confidence: semantic.confidence || "medium",


      text: semantic.text || text,


      inheritance_policy: inferInheritancePolicy(semantic),


    });


  }


  const semanticRegionEntries = entries.slice();

  const textRe = /<(p|span|button|a)\b([^>]*)>([^<]{1,80})<\/\1>/g;


  while ((match = textRe.exec(html))) {


    const attrs = match[2] || "";


    const text = extractInnerText(match[3]);


    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);


    const id = idMatch && idMatch[1];


    if (!id || !text) continue;


    const bbox = findNearestBboxBefore(html, match.index);
    const parentSemantic = inferTextParentSemanticFromBbox(bbox, semanticRegionEntries) || findNearestSemanticBefore(html, match.index);


    entries.push({


      name: textAnchorName(text, bbox, parentSemantic),


      selector: `#${id}`,


      id,


      area: bbox && bbox.y >= 700 ? "bottom-area" : "content-area",


      component: "text",


      element: text,


      bbox: bbox ? [bbox.x, bbox.y, bbox.w, bbox.h] : null,


      confidence: "high",


      text,


      inheritance_policy: "hideable",


    });


  }


  return entries;


}





function findNearestBboxBefore(html, index) {


  const before = String(html || "").slice(0, index);


  const matches = Array.from(before.matchAll(/<!--\s*bbox:\s*key=id:([^\s|]+)\s*\|\s*x=(-?\d+(?:\.\d+)?)\s*y=(-?\d+(?:\.\d+)?)\s*w=(-?\d+(?:\.\d+)?)\s*h=(-?\d+(?:\.\d+)?)\s*-->/g));


  const match = matches[matches.length - 1];


  if (!match) return null;


  return {


    id: match[1],


    x: Number(match[2]),


    y: Number(match[3]),


    w: Number(match[4]),


    h: Number(match[5]),


  };


}

function findNearestSemanticBefore(html, index) {
  const before = String(html || "").slice(0, index);
  const matches = Array.from(before.matchAll(/<!--\s*semantic:\s*([\s\S]*?)\s*-->\s*<([a-zA-Z][\w:-]*)\b([^>]*)>/g));
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const attrs = match[3] || "";
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    const openIndex = match.index + match[0].length;
    const closeIndex = html.indexOf("</div>", openIndex);
    if (closeIndex >= index) return parseSemanticComment(match[1]);
  }
  return null;
}

function bboxContains(parent, child) {
  if (!parent || !child) return false;
  const px = Number(parent[0]);
  const py = Number(parent[1]);
  const pw = Number(parent[2]);
  const ph = Number(parent[3]);
  const cx = Number(child.x);
  const cy = Number(child.y);
  const cw = Number(child.w);
  const ch = Number(child.h);
  if (![px, py, pw, ph, cx, cy, cw, ch].every(Number.isFinite)) return false;
  return cx >= px - 1 && cy >= py - 1 && cx + cw <= px + pw + 1 && cy + ch <= py + ph + 1;
}

function inferTextParentSemanticFromBbox(bbox, semanticEntries) {
  if (!bbox) return null;
  const matches = semanticEntries
    .filter((entry) => Array.isArray(entry.bbox) && bboxContains(entry.bbox, bbox))
    .sort((a, b) => {
      const ab = a.bbox || [0, 0, 9999, 9999];
      const bb = b.bbox || [0, 0, 9999, 9999];
      return (ab[2] * ab[3]) - (bb[2] * bb[3]);
    });
  const found = matches[0];
  if (!found) return null;
  return {
    area: found.area,
    component: found.component,
    semantic: found.component,
    range: found.element,
  };
}





function dedupeEntries(entries) {


  const counts = new Map();


  const byName = {};


  for (const entry of entries) {


    let name = entry.name;


    if (byName[name]) {


      const n = (counts.get(name) || 1) + 1;


      counts.set(name, n);


      name = `${name}-${n}`;


    } else {


      counts.set(name, 1);


    }


    byName[name] = { ...entry, name };


  }


  return byName;


}





function buildSemanticAnchors(registry) {


  const anchors = {};


  for (const [name, entry] of Object.entries(registry)) {


    anchors[name] = entry.selector;


  }


  return anchors;


}

// HTML void elements must not be pushed onto the tag stack; treating `<br>` etc.
// as open tags corrupts parent resolution when text nodes contain `<br><br>`.
const VOID_HTML_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function parseParentById(html) {
  const tokenRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
  const stack = [];
  const parentById = {};
  let match;
  while ((match = tokenRe.exec(html))) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const closing = full.startsWith("</");
    if (closing) {
      if (stack.length) stack.pop();
      continue;
    }
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    const id = idMatch && idMatch[1];
    if (id) {
      const parent = [...stack].reverse().find((item) => item.id);
      parentById[id] = parent ? parent.id : null;
    }
    const selfClosing = full.endsWith("/>") || VOID_HTML_TAGS.has(tag);
    if (!selfClosing) stack.push({ tag, id: id || null });
  }
  return parentById;
}

function buildSemanticTree(registry, html) {
  const parentById = parseParentById(html);
  const byId = {};
  for (const entry of Object.values(registry)) byId[entry.id] = entry;
  const nodes = {};
  for (const entry of Object.values(registry)) {
    nodes[entry.name] = {
      name: entry.name,
      anchor: entry.name,
      selector: entry.selector,
      id: entry.id,
      area: entry.area,
      component: entry.component,
      semantic: entry.component,
      element: entry.element,
      range: entry.element,
      bbox: entry.bbox || null,
      text: entry.text,
      confidence: entry.confidence,
      policy: entry.inheritance_policy,
      inheritance_policy: entry.inheritance_policy,
      parent: null,
      children: [],
    };
  }
  const roots = [];
  for (const entry of Object.values(registry)) {
    let parentId = parentById[entry.id];
    let parentEntry = null;
    while (parentId) {
      if (byId[parentId]) {
        parentEntry = byId[parentId];
        break;
      }
      parentId = parentById[parentId];
    }
    if (parentEntry && nodes[parentEntry.name]) {
      nodes[entry.name].parent = parentEntry.name;
      nodes[parentEntry.name].children.push(entry.name);
    } else {
      roots.push(entry.name);
    }
  }
  return { roots, nodes };
}

function buildNestedSemanticRegistry(registry, html) {
  const tree = buildSemanticTree(registry, html);
  const nodes = {};
  for (const [name, node] of Object.entries(tree.nodes || {})) {
    nodes[name] = {
      anchor: node.anchor || name,
      selector: node.selector,
      id: node.id,
      area: node.area,
      component: node.component || node.semantic,
      element: node.element || node.range,
      bbox: node.bbox || null,
      text: node.text || "",
      policy: node.policy || node.inheritance_policy,
      confidence: node.confidence,
      children: [],
    };
  }
  for (const [name, node] of Object.entries(tree.nodes || {})) {
    if (!nodes[name]) continue;
    nodes[name].children = (node.children || [])
      .map((childName) => nodes[childName])
      .filter(Boolean);
  }
  return {
    type: "tree",
    roots: (tree.roots || []).map((name) => nodes[name]).filter(Boolean),
  };
}





function main() {


  const args = process.argv.slice(2);


  const input = argValue(args, "--input", args[0]);


  if (!input) throw new Error("Usage: node build_semantic_registry.js --input annotated_body_semantic.html --out semantic_registry.json");


  const out = argValue(args, "--out", path.join(path.dirname(input), "semantic_registry.json"));


  const jsOut = argValue(args, "--js-out", path.join(path.dirname(input), "semantic_anchors.js"));


  const html = readUtf8(input);


  const registry = dedupeEntries(parseRegistryFromAnnotatedHtml(html));


  const semanticAnchors = buildSemanticAnchors(registry);
  const semanticTree = buildSemanticTree(registry, html);
  const semanticRegistryTree = buildNestedSemanticRegistry(registry, html);


  const result = {


    generated_at: new Date().toISOString(),


    source: input,


    semantic_dom_registry: registry,


    semanticAnchors,

    semantic_dom_tree: semanticTree,

    semantic_registry_tree: semanticRegistryTree,


  };


  writeUtf8(out, JSON.stringify(result, null, 2));


  writeUtf8(jsOut, `const semanticAnchors = ${JSON.stringify(semanticAnchors, null, 2)};\n`);


  console.log(`[semantic-registry] anchors=${Object.keys(registry).length} out=${out}`);


}





try {


  main();


} catch (err) {


  console.error("[semantic-registry] ERROR:", err.message);


  process.exit(1);


}


