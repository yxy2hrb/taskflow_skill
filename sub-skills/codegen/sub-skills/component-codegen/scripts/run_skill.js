"use strict";

const fs = require("fs");
const path = require("path");
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

function loadDotEnv(file) {
  if (!exists(file)) return;
  for (const line of readUtf8(file).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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
  return callJsonChat({ model, system, user, maxTokens, label: "component-codegen" });
}

function componentText(component) {
  const visible = component.visible_text;
  if (typeof visible === "string") return visible;
  if (visible && typeof visible === "object") return Object.values(visible).flat().join(" ");
  return component.text || component.description || "";
}

function fallbackComponent({ component, operation, originalComponent }) {
  const id = component.id || component.name || "component";
  const bbox = Array.isArray(component.bbox) ? component.bbox : [0, 0, 120, 40];
  const kind = String(component.component || "component").toLowerCase();
  const text = componentText(component) || (operation === "update" && originalComponent?.text) || "";
  const style = `position:absolute;left:${Number(bbox[0] || 0)}px;top:${Number(bbox[1] || 0)}px;width:${Number(bbox[2] || 0)}px;height:${Number(bbox[3] || 0)}px;`;
  const cls = kind.includes("button") ? "tf-cg-button" : kind.includes("input") ? "tf-cg-input" : kind.includes("toast") ? "tf-cg-toast" : "tf-cg-card";
  return {
    id,
    html: `<div data-component-id="${id}" class="tf-component ${cls}" style="${style}">${text}</div>`,
    css: ".tf-cg-card{background:#fff;border:1px solid #f0f0f0;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:12px 16px;box-sizing:border-box;color:#1f1f1f}.tf-cg-button{display:flex;align-items:center;justify-content:center;border-radius:10px;background:#1677ff;color:#fff;font-weight:600;box-sizing:border-box}.tf-cg-input{display:flex;align-items:center;background:#fff;border:1px solid #f0f0f0;border-radius:12px;padding:0 14px;box-sizing:border-box;color:#999}.tf-cg-toast{display:flex;align-items:center;justify-content:center;border-radius:10px;background:rgba(0,0,0,.75);color:#fff;box-sizing:border-box}",
    notes: "fallback component",
  };
}

function validateComponent(parsed, id) {
  const issues = [];
  if (!parsed || typeof parsed !== "object") issues.push("response is not object");
  if (parsed.id && parsed.id !== id) issues.push(`id mismatch: expected ${id}, got ${parsed.id}`);
  if (typeof parsed.html !== "string" || !parsed.html.includes("data-component-id")) issues.push("missing component html");
  if (typeof parsed.css !== "string") issues.push("missing css string");
  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  const base = path.resolve(ROOT, args[0] || ".");
  const modelName = resolveTextModel(argValue(args, "--model", ""));
  const stateModelPath = path.resolve(ROOT, argValue(args, "--state-model", path.join(base, ".run_skill/latest/state_implementation/state_implementation_model.llm.json")));
  const outDir = path.resolve(ROOT, argValue(args, "--out-dir", path.join(base, ".run_skill", "component_codegen")));
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const maxTokens = Number(argValue(args, "--max-tokens", "5000"));
  const useFallback = args.includes("--fallback");

  const stateModel = readJson(stateModelPath);
  const skill = readUtf8(path.resolve(__dirname, "..", "SKILL.md"));
  const generatedById = {};
  const components = [];
  const rawDir = path.join(outDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });

  for (const state of stateModel.states || []) {
    const stateContext = { id: state.id, label: state.label, ui_intent: state.ui_intent, parent_state: state.parent_state };
    for (const component of state.inheritance?.create || []) {
      const id = component.id || component.name;
      if (!id) continue;
      const input = { operation: "create", viewport: { width, initial_height: height }, state_context: stateContext, component };
      let parsed;
      let raw = "";
      if (useFallback) {
        parsed = fallbackComponent({ component, operation: "create" });
      } else {
        raw = await callLLM({ model: modelName, system: `${skill}\n\nReturn JSON only.`, user: JSON.stringify(input), maxTokens });
        parsed = extractJson(raw);
      }
      const issues = validateComponent(parsed, id);
      if (issues.length) parsed = fallbackComponent({ component, operation: "create" });
      const record = { state_id: state.id, operation: "create", component: parsed, input, issues };
      components.push(record);
      generatedById[id] = parsed;
      if (raw) writeUtf8(path.join(rawDir, `${state.id}_${id}.raw.txt`), raw);
    }
    for (const component of state.inheritance?.update || []) {
      const id = component.id || component.name;
      if (!id) continue;
      const originalComponent = generatedById[id] || null;
      const input = { operation: "update", viewport: { width, initial_height: height }, state_context: stateContext, component, original_component: originalComponent };
      let parsed;
      let raw = "";
      if (useFallback) {
        parsed = fallbackComponent({ component, operation: "update", originalComponent });
      } else {
        raw = await callLLM({ model: modelName, system: `${skill}\n\nReturn JSON only.`, user: JSON.stringify(input), maxTokens });
        parsed = extractJson(raw);
      }
      const issues = validateComponent(parsed, id);
      if (issues.length) parsed = fallbackComponent({ component, operation: "update", originalComponent });
      const record = { state_id: state.id, operation: "update", original_component_id: originalComponent?.id || null, component: parsed, input, issues };
      components.push(record);
      generatedById[id] = parsed;
      if (raw) writeUtf8(path.join(rawDir, `${state.id}_${id}.raw.txt`), raw);
    }
  }

  const output = { ok: true, source_state_model: rel(stateModelPath), components };
  writeJson(path.join(outDir, "component_codegen.generated.json"), output);
  writeJson(path.join(outDir, "run_report.json"), { ok: true, component_count: components.length, output: rel(path.join(outDir, "component_codegen.generated.json")) });
  console.log(`[component-codegen] ok=true components=${components.length} out=${rel(path.join(outDir, "component_codegen.generated.json"))}`);
}

main().catch((err) => {
  console.error("[component-codegen] ERROR:", err.stack || err.message);
  process.exit(1);
});
