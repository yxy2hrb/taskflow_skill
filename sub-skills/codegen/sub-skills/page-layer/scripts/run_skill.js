// LLM-generated React + AntD static state-layer runner.
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");
const { loadSkillEnv } = require("../../../../../scripts/paths");
const { callJsonChat, resolveTextModel } = require("../../../../../scripts/llm_config");

const ROOT = path.resolve(__dirname, "../../../../../../../..");

function readUtf8(file) { return fs.readFileSync(file, "utf8"); }
function readJson(file) { return JSON.parse(readUtf8(file)); }
function writeUtf8(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, "utf8"); }
function writeJson(file, value) { writeUtf8(file, JSON.stringify(value, null, 2)); }
function exists(file) { return fs.existsSync(file); }
function argValue(args, name, fallback) { const idx = args.indexOf(name); return idx >= 0 ? args[idx + 1] : fallback; }
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function stateNum(id) { const m = String(id || "").match(/(\d+)/); return m ? Number(m[1]) : 0; }
function extractBlock(html, tag) { const m = String(html || "").match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i")); return m ? m[0] : ""; }
function extractBodyInner(html) { const m = String(html || "").match(/<body[^>]*>([\s\S]*?)<\/body>/i); return m ? m[1] : String(html || ""); }

function loadDotEnv(file) {
  if (!exists(file)) return;
  for (const line of readUtf8(file).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] == null) process.env[match[1]] = value;
  }
}

function stripThink(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJson(text) {
  let source = stripThink(text);
  const markdown = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (markdown) source = markdown[1].trim();
  const json = source.match(/\{[\s\S]*\}/);
  if (json) source = json[0];
  return JSON.parse(source);
}

async function callLLM({ model, system, user, maxTokens }) {
  loadSkillEnv();
  return callJsonChat({ model, system, user, maxTokens, label: "page-layer" });
}

function slimRegistry(registry) {
  const out = {};
  for (const [name, item] of Object.entries(registry.semantic_dom_registry || {})) {
    out[name] = {
      selector: item.selector,
      bbox: item.bbox,
      area: item.area,
      component: item.component || item.semantic,
      text: item.text || "",
      policy: item.inheritance_policy,
    };
  }
  return out;
}

function slimStateModel(model) {
  return {
    states: (model.states || []).map((state) => ({
      id: state.id,
      label: state.label,
      ui_intent: state.ui_intent,
      parent_state: state.parent_state,
      trigger: state.trigger || null,
      inheritance: {
        keep: state.inheritance?.keep || [],
        create: state.inheritance?.create || [],
        update: state.inheritance?.update || [],
      },
      patches: state.patches || [],
    })),
  };
}

function normalizeBlueprint(input, model) {
  if (input?.meta && Array.isArray(input.states)) return input;
  if (input?.merged_states_by_id) {
    return {
      states: Object.values(input.merged_states_by_id)
        .map((s) => ({ state_id: stateNum(s.id), state_name: s.label || s.id, description: s.description || "" }))
        .filter((s) => s.state_id > 0)
        .sort((a, b) => a.state_id - b.state_id),
    };
  }
  return { states: (model.states || []).map((s) => ({ state_id: stateNum(s.id), state_name: s.label || s.id, description: s.ui_intent || "" })) };
}

function buildPromptInput({ registry, model, blueprint, componentCodegen, width, height }) {
  return {
    viewport: {
      width,
      initial_height: height,
      width_locked: true,
      height_may_expand: true,
    },
    blueprint: normalizeBlueprint(blueprint, model),
    semantic_registry: slimRegistry(registry),
    state_implementation_model: slimStateModel(model),
    component_codegen: componentCodegen || null,
  };
}

function validateGenerated(parsed) {
  const issues = [];
  if (!parsed || typeof parsed !== "object") issues.push("response is not object");
  if (typeof parsed.html !== "string" || !parsed.html.includes("tf-state-")) issues.push("missing html tf-state layers");
  if (typeof parsed.css !== "string") issues.push("missing css string");
  return issues;
}

function escapeAttr(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bboxTop(record) {
  const bbox = record?.input?.component?.bbox;
  return Array.isArray(bbox) ? Number(bbox[1] || 0) : 0;
}

function buildFallbackGenerated(stateModel, componentCodegen) {
  const components = Array.isArray(componentCodegen?.components) ? componentCodegen.components : [];
  const html = [];
  const css = [];

  for (const state of stateModel.states || []) {
    if (stateNum(state.id) <= 1) continue;
    const parts = [];
    for (const anchor of state.inheritance?.keep || []) {
      parts.push(`<div class="tf-keep-placeholder" data-keep-anchor="${escapeAttr(anchor)}"></div>`);
    }
    const records = components
      .filter((record) => record.state_id === state.id && record.component?.html)
      .sort((a, b) => bboxTop(a) - bboxTop(b));
    for (const record of records) {
      parts.push(record.component.html);
      if (record.component.css) css.push(record.component.css);
    }
    html.push(`<section id="tf-state-${stateNum(state.id)}" class="tf-state-layer tf-llm-layer" style="display:none">${parts.join("")}</section>`);
  }

  return {
    html: html.join(""),
    css: Array.from(new Set(css)).join("\n"),
    validation_notes: "fallback deterministic layer assembly from state model and component_codegen",
  };
}

function buildHtml({ originalHtml, registry, generated, stateModel, width, height }) {
  const head = extractBlock(originalHtml, "head") || "<head><meta charset=\"utf-8\"></head>";
  const body = extractBodyInner(originalHtml);
  const runtimeModel = slimStateModel(stateModel);
  return `<!doctype html>
<html lang="zh-CN">
${head}
<body>
<div id="app-root">${body}</div>
<div id="tf-layer-root">${generated.html || ""}</div>
<style id="tf-llm-base-style">
.tf-state-layer{position:fixed;left:0;top:0;width:${width}px;min-height:${height}px;z-index:9999;background:#f5f5f5;color:#1f1f1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overflow-y:auto;overflow-x:hidden}
.tf-llm-layer *{box-sizing:border-box}
.tf-keep-placeholder{position:absolute;overflow:hidden;pointer-events:none}
.tf-keep-placeholder>.tf-keep-crop{position:absolute;pointer-events:none}
${generated.css || ""}
.tf-state-layer.tf-llm-layer{position:fixed!important;left:0!important;top:0!important;width:${width}px!important;min-height:${height}px!important;z-index:9999!important;overflow-y:auto;overflow-x:hidden}
.tf-state-layer.tf-llm-layer>.tf-component{position:absolute}
.tf-state-layer .tf-keep-placeholder{display:block!important;visibility:visible!important}
.tf-state-layer .tf-keep-placeholder>.tf-keep-crop{display:block!important;visibility:visible!important}
</style>
<script>
window.__TF_REGISTRY__=${JSON.stringify(registry.semantic_dom_registry || {})};
window.__TF_ANCHORS__=${JSON.stringify(registry.semanticAnchors || {})};
window.__TF_STATE_MODEL__=${JSON.stringify(runtimeModel)};
function tfNum(id){
  const match=String(id||"").match(/(\\d+)/);
  return match?Number(match[1]):0;
}
function tfCssEscape(value){
  if(window.CSS && typeof window.CSS.escape==="function") return window.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g,"\\\\$&");
}
function tfPx(value){
  const n=Number(value||0);
  return Number.isFinite(n)?n:0;
}
function tfStyleNumber(el,name){
  if(!el) return NaN;
  const inline=el.style && el.style[name];
  if(inline) return parseFloat(inline);
  const computed=window.getComputedStyle?window.getComputedStyle(el):null;
  return computed ? parseFloat(computed[name]) : NaN;
}
function tfStateById(id){
  const model=window.__TF_STATE_MODEL__ || {};
  return (model.states||[]).find(function(state){ return state.id===id; }) || null;
}
function tfSourceSpec(state, anchor){
  if(!state || !state.inheritance) return null;
  const lists=[state.inheritance.create||[],state.inheritance.update||[]];
  for(const list of lists){
    const hit=list.find(function(item){ return item && item.id===anchor; });
    if(hit) return hit;
  }
  return null;
}
function tfAncestorStates(stateNumber){
  const out=[];
  let state=tfStateById("state_"+stateNumber);
  const seen=new Set();
  while(state && state.parent_state && !seen.has(state.parent_state)){
    seen.add(state.parent_state);
    const parent=tfStateById(state.parent_state);
    if(!parent) break;
    out.push(parent);
    state=parent;
  }
  return out;
}
function tfFindVirtualNode(sourceLayer, anchor, spec){
  if(!sourceLayer) return null;
  const escaped=tfCssEscape(anchor);
  const direct=sourceLayer.querySelector("#"+escaped+",[data-component-id='"+String(anchor).replace(/'/g,"\\\\'")+"']");
  if(direct) return direct;
  if(spec && Array.isArray(spec.bbox)){
    const bbox=spec.bbox.map(tfPx);
    const candidates=sourceLayer.querySelectorAll("[style]");
    for(const node of candidates){
      const left=tfStyleNumber(node,"left");
      const top=tfStyleNumber(node,"top");
      const width=tfStyleNumber(node,"width");
      const height=tfStyleNumber(node,"height");
      if(Math.abs(left-bbox[0])<=1 && Math.abs(top-bbox[1])<=1 && Math.abs(width-bbox[2])<=1 && Math.abs(height-bbox[3])<=1) {
        return node;
      }
    }
  }
  if(spec && /app_bar|nav_bar|navbar|header/i.test(String(spec.component||""))) {
    return sourceLayer.querySelector(".tf-llm-appbar,.tf-appbar,.tf-app_bar,.tf-navbar,.tf-nav_bar,.tf-header");
  }
  return null;
}
function tfFillVirtualKeep(slot, layer, anchor){
  const stateNumber=tfNum(layer && layer.id);
  const ancestors=tfAncestorStates(stateNumber);
  for(const state of ancestors){
    const spec=tfSourceSpec(state, anchor);
    if(!spec) continue;
    const sourceLayer=document.getElementById("tf-state-"+tfNum(state.id));
    const source=tfFindVirtualNode(sourceLayer, anchor, spec);
    if(!source) continue;
    const bbox=Array.isArray(spec.bbox) ? spec.bbox.map(tfPx) : [
      tfStyleNumber(source,"left"),
      tfStyleNumber(source,"top"),
      tfStyleNumber(source,"width"),
      tfStyleNumber(source,"height"),
    ];
    if(bbox.some(function(n){ return !Number.isFinite(n); })) return false;
    slot.style.left=bbox[0]+"px";
    slot.style.top=bbox[1]+"px";
    slot.style.width=bbox[2]+"px";
    slot.style.height=bbox[3]+"px";
    const clone=source.cloneNode(true);
    clone.removeAttribute("id");
    clone.style.position="absolute";
    clone.style.left="0px";
    clone.style.top="0px";
    clone.style.width=bbox[2]+"px";
    clone.style.height=bbox[3]+"px";
    slot.appendChild(clone);
    return true;
  }
  return false;
}
function tfFillKeepPlaceholders(layer){
  if(!layer) return;
  const appRoot=document.getElementById("app-root");
  layer.querySelectorAll("[data-keep-anchor]").forEach(function(slot){
    const anchor=slot.getAttribute("data-keep-anchor");
    const registry=window.__TF_REGISTRY__ || {};
    const bbox=registry[anchor] && registry[anchor].bbox;
    slot.innerHTML="";
    if(!Array.isArray(bbox) || !appRoot) {
      tfFillVirtualKeep(slot, layer, anchor);
      return;
    }
    slot.style.left=Number(bbox[0]||0)+"px";
    slot.style.top=Number(bbox[1]||0)+"px";
    slot.style.width=Number(bbox[2]||0)+"px";
    slot.style.height=Number(bbox[3]||0)+"px";
    const crop=document.createElement("div");
    crop.className="tf-keep-crop";
    crop.style.left=(-Number(bbox[0]||0))+"px";
    crop.style.top=(-Number(bbox[1]||0))+"px";
    crop.style.width="${width}px";
    crop.style.height="${height}px";
    Array.prototype.forEach.call(appRoot.childNodes,function(node){ crop.appendChild(node.cloneNode(true)); });
    slot.appendChild(crop);
  });
}
function tfInstallGoto(){
  window.TF={current:1,goto:function(id){
    const n=Number(String(id).replace(/\\D/g,""))||1;
    this.current=n;
    document.querySelectorAll(".tf-state-layer").forEach(function(layer){layer.style.display="none";});
    if(n===1) return;
    const layer=document.getElementById("tf-state-"+n);
    if(layer){ tfFillKeepPlaceholders(layer); layer.style.display="block"; }
  }};
}
tfInstallGoto();
function tfInstallBindings(){
  var model=window.__TF_STATE_MODEL__;
  var reg=window.__TF_REGISTRY__;
  if(!model||!reg) return;
  function stateNum(id){return Number(String(id||"").replace(/\\D/g,""))||1;}
  function findEl(anchor){
    var entry=reg[anchor];
    if(entry&&entry.selector){
      try{var el=document.querySelector(entry.selector);if(el) return el;}catch(e){}
    }
    if(entry&&entry.id){var el2=document.querySelector('[id="'+entry.id+'"]');if(el2) return el2;}
    return document.querySelector('[data-component-id="'+anchor+'"]');
  }
  (model.states||[]).forEach(function(state){
    (state.patches||[]).forEach(function(patch){
      if(patch.type!=="bind"||patch.action!=="click") return;
      var el=findEl(patch.anchor);
      if(!el) return;
      el.style.cursor="pointer";
      el.addEventListener("click",function(e){e.stopPropagation();TF.goto(stateNum(patch.goto));});
    });
    var parentNum=state.parent_state?stateNum(state.parent_state):null;
    if(!parentNum) return;
    ((state.inheritance&&state.inheritance.create)||[]).forEach(function(c){
      if(c.component!=="Overlay"&&!/overlay|mask/i.test(c.id||"")) return;
      var el=findEl(c.id);
      if(!el) return;
      el.style.cursor="pointer";
      el.addEventListener("click",function(e){
        if(TF.current===stateNum(state.id)){e.stopPropagation();TF.goto(parentNum);}
      });
    });
  });
}
tfInstallBindings();
window.__TF_LLM_READY__=true;
</script>
</body>
</html>`;
}

async function screenshotStates({ htmlPath, blueprint, model, outDir, width, height }) {
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });
  const normalized = normalizeBlueprint(blueprint, model);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__TF_LLM_READY__ && window.TF && typeof window.TF.goto === "function", null, { timeout: 20000 });
  const shots = [];
  for (const state of normalized.states) {
    await page.evaluate((n) => window.TF.goto(n), state.state_id);
    await page.waitForTimeout(400);
    const file = `state_${state.state_id}_force.png`;
    const target = path.join(outDir, file);
    await page.screenshot({ path: target, fullPage: false });
    const notBlank = fs.statSync(target).size > 1000;
    shots.push({ state_id: state.state_id, state_name: state.state_name, screenshot: file, not_blank: notBlank, status: notBlank ? "pass" : "fail", issues: notBlank ? [] : ["blank screenshot"] });
  }
  await browser.close();
  const issues = shots.filter((shot) => shot.issues.length);
  const report = { html_path: rel(htmlPath), timestamp: new Date().toISOString(), shots, summary: { total_states: shots.length, force_pass: shots.filter((s) => s.status === "pass").length, issues_found: issues } };
  writeJson(path.join(outDir, "state_layers_report.json"), report);
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const base = path.resolve(ROOT, args[0] || ".");
  const modelName = resolveTextModel(argValue(args, "--model", ""));
  const htmlPath = path.resolve(ROOT, argValue(args, "--html", path.join(base, ".run_skill/latest/preprocess/Index.preprocessed.html")));
  const registryPath = path.resolve(ROOT, argValue(args, "--registry", path.join(base, ".run_skill/latest/preprocess/semantic_registry.json")));
  const stateModelPath = path.resolve(ROOT, argValue(args, "--state-model", path.join(base, ".run_skill/latest/state_implementation/state_implementation_model.llm.json")));
  const blueprintPath = path.resolve(ROOT, argValue(args, "--blueprint", ""));
  const componentCodegenPath = path.resolve(ROOT, argValue(args, "--component-codegen", ""));
  const outDir = path.resolve(ROOT, argValue(args, "--out-dir", path.join(base, ".run_skill", "llm_layer_codegen")));
  const outHtml = path.resolve(ROOT, argValue(args, "--out-html", path.join(base, "html", "Index.state-model.llm-layers.html")));
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const maxTokens = Number(argValue(args, "--max-tokens", "16000"));
  const useFallback = args.includes("--fallback");

  const originalHtml = readUtf8(htmlPath);
  const registry = readJson(registryPath);
  const stateModel = readJson(stateModelPath);
  const blueprint = blueprintPath && exists(blueprintPath) ? readJson(blueprintPath) : null;
  const componentCodegen = componentCodegenPath && exists(componentCodegenPath) ? readJson(componentCodegenPath) : null;
  const skillPath = path.resolve(__dirname, "..", "SKILL.md");
  const skillPrompt = readUtf8(skillPath);
  const promptInput = buildPromptInput({ registry, model: stateModel, blueprint, componentCodegen, width, height });
  writeJson(path.join(outDir, "llm_layer_input.json"), promptInput);

  const system = [
    skillPrompt,
    "Follow the SKILL.md above exactly.",
    "Return strict JSON only.",
  ].join("\n");
  const raw = useFallback ? "" : await callLLM({ model: modelName, system, user: JSON.stringify(promptInput), maxTokens });
  if (raw) writeUtf8(path.join(outDir, "llm_layer.raw.txt"), raw);
  const generated = useFallback ? buildFallbackGenerated(stateModel, componentCodegen) : extractJson(raw);
  const issues = validateGenerated(generated);
  writeJson(path.join(outDir, "llm_layer.generated.json"), generated);
  writeJson(path.join(outDir, "llm_layer.validation.json"), { issues });
  if (issues.length) {
    console.error("[llm-layer] validation issues:\n" + issues.join("\n"));
    process.exit(2);
  }

  const html = buildHtml({ originalHtml, registry, generated, stateModel, width, height });
  writeUtf8(outHtml, html);
  const shotsDir = path.join(outDir, "auto_shots");
  const shotReport = await screenshotStates({ htmlPath: outHtml, blueprint, model: stateModel, outDir: shotsDir, width, height });
  const ok = shotReport.summary.issues_found.length === 0;
  writeJson(path.join(outDir, "run_report.json"), { ok, outputs: { html: rel(outHtml), auto_shots: rel(shotsDir), state_layers_report: rel(path.join(shotsDir, "state_layers_report.json")) }, screenshot_summary: shotReport.summary });
  console.log(`[llm-layer] ok=${ok} out=${rel(outHtml)}`);
  if (!ok) process.exitCode = 2;
}

main().catch((err) => {
  console.error("[llm-layer] ERROR:", err.stack || err.message);
  process.exit(1);
});
