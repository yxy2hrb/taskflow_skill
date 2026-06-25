#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadSkillEnv } = require("../../../../../scripts/paths");
const { callJsonChat, resolveTextModel } = require("../../../../../scripts/llm_config");

const ROOT = path.resolve(__dirname, "../../../../../../../..");

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

function stateNum(id) {
  const match = String(id || "").match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of readUtf8(file).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

function latestBlueprint(base) {
  const dir = path.join(base, "html");
  const hits = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (name === "blueprint_builder_input.json") hits.push(file);
    }
  }
  walk(dir);
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0];
}

function lightweightRegistry(registry) {
  const out = {};
  for (const [name, entry] of Object.entries(registry.semantic_dom_registry || {})) {
    out[name] = {
      selector: entry.selector,
      semantic: entry.component || entry.semantic,
      text: entry.text,
      area: entry.area,
      policy: entry.inheritance_policy,
    };
  }
  return out;
}

function anchorBboxes(registry) {
  const out = {};
  for (const [name, entry] of Object.entries(registry.semantic_dom_registry || {})) {
    out[name] = entry.bbox || null;
  }
  return out;
}

function layoutConstraints() {
  return [
    "If a state keeps a top/status anchor, created full-page content must start below that anchor bbox.",
    "If a state keeps a bottom/nav anchor, created content must end above that anchor bbox.",
    "If the state is not a modal, drawer, popover, toast, or overlay, every created component bbox must avoid overlap with kept bboxes.",
    "Do not output hide or replace. The implementation model only contains keep, create, and update.",
    "Generated UI should support an antd Mobile visual style and Gestalt grouping.",
  ];
}

function ownString(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === "string" ? obj[key] : null;
}

function patchAnchor(patch) {
  return ownString(patch, "target_anchor") || ownString(patch, "anchor") || ownString(patch, "target") || ownString(patch, "id") || null;
}

function componentKind(patch) {
  return String(patch?.component || patch?.type || "").toLowerCase();
}

function mountParentId(patch) {
  const mount = ownString(patch, "mount");
  const match = mount && mount.match(/^inside:(.+)$/i);
  return match ? match[1].trim() : null;
}

function removeListInternalActionCreates(create) {
  const byId = new Map();
  for (const patch of create) {
    const id = patch?.id || patch?.name;
    if (id) byId.set(id, patch);
  }

  return create.filter((patch) => {
    const parent = byId.get(mountParentId(patch));
    if (!parent) return true;
    const parentKind = componentKind(parent);
    const childKind = componentKind(patch);
    if (!/(^|[^a-z])(list|grid|cardlist|cards)([^a-z]|$)/i.test(parentKind)) return true;
    return !/(^|[^a-z])(button|link|action)([^a-z]|$)/i.test(childKind);
  });
}

function normalizeModel(model) {
  delete model.semanticAnchors;
  delete model.semantic_registry;

  for (const state of model.states || []) {
    if (!state.trigger || typeof state.trigger !== "object" || Array.isArray(state.trigger)) state.trigger = null;

    const patchList = Array.isArray(state.patches) ? state.patches : [];
    const inheritance = state.inheritance && typeof state.inheritance === "object" && !Array.isArray(state.inheritance) ? state.inheritance : {};
    const keep = new Set(inheritance.keep || []);
    const create = Array.isArray(inheritance.create) ? inheritance.create.slice() : [];
    const update = Array.isArray(inheritance.update) ? inheritance.update.slice() : [];

    for (const patch of patchList) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
      const anchor = patchAnchor(patch);
      if (patch.type === "keep" && anchor) keep.add(anchor);
      if (patch.type === "create") create.push(patch);
      if (patch.type === "update") update.push(patch);
      if (patch.type === "bind" && !state.trigger && anchor) {
        state.trigger = { event: patch.event || "click", anchor, action: patch.action || `goto:${state.id}` };
      }
    }

    const bindPatch = patchList.find((patch) => patch.type === "bind" && (patch.goto || patch.action));
    if (bindPatch && state.trigger) {
      const gotoAction = bindPatch.action || (bindPatch.goto ? `goto:${bindPatch.goto}` : null);
      if (gotoAction) state.trigger.action = gotoAction;
    }

    state.inheritance = { keep: [...keep], create: removeListInternalActionCreates(create), update };
    state.patches = patchList.filter((patch) => patch?.type !== "hide" && patch?.type !== "replace");
  }

  return model;
}

function validateModel(model, registry) {
  const issues = [];
  const originalAnchors = new Set(Object.keys(registry.semanticAnchors || {}));
  const virtualAnchors = new Set();

  if (!Array.isArray(model.states)) issues.push("missing states[]");
  const sorted = [...(model.states || [])].sort((a, b) => stateNum(a.id) - stateNum(b.id));

  function isSystemTrigger(trigger) {
    if (!trigger || typeof trigger !== "object") return false;
    return /timeout|load_complete|submit_success|system|auto|data_loaded|success|完成|系统|自动/i.test(JSON.stringify(trigger));
  }

  for (const state of sorted) {
    if (!state.id) issues.push("state missing id");
    if (stateNum(state.id) > 1 && !state.parent_state) issues.push(`${state.id} missing parent_state`);
    if (state.inheritance?.hide) issues.push(`${state.id} must not output inheritance.hide`);
    if (state.inheritance?.replace) issues.push(`${state.id} must not output inheritance.replace`);

    const refs = [];
    if (state.trigger?.anchor && !isSystemTrigger(state.trigger)) refs.push(state.trigger.anchor);
    for (const item of state.inheritance?.keep || []) {
      const anchor = typeof item === "string" ? item : patchAnchor(item);
      if (anchor) refs.push(anchor);
    }
    for (const patch of state.inheritance?.update || []) {
      const anchor = patchAnchor(patch);
      if (anchor) refs.push(anchor);
    }
    for (const anchor of refs) {
      if (typeof anchor !== "string" || (!originalAnchors.has(anchor) && !virtualAnchors.has(anchor))) {
        issues.push(`${state.id} references unknown anchor: ${anchor}`);
      }
    }
    for (const patch of state.inheritance?.create || []) {
      const id = patch.id || patch.name;
      if (id) virtualAnchors.add(id);
    }
    for (const patch of state.patches || []) {
      if (patch.type === "create") {
        const id = patch.id || patch.name;
        if (id) virtualAnchors.add(id);
      }
      if (patch.type === "hide" || patch.type === "replace") issues.push(`${state.id} must not contain ${patch.type} patch`);
    }
  }

  return issues;
}

async function callLLM({ model, system, user, maxTokens }) {
  loadSkillEnv();
  return callJsonChat({ model, system, user, maxTokens, label: "state-implementation-model" });
}

async function main() {
  const args = process.argv.slice(2);
  const base = path.resolve(ROOT, args[0] || "new_test/2");
  const model = resolveTextModel(argValue(args, "--model", ""));
  const width = Number(argValue(args, "--width", "360"));
  const height = Number(argValue(args, "--height", "792"));
  const blueprintPath = path.resolve(ROOT, argValue(args, "--blueprint", latestBlueprint(base)));
  const registryPath = path.resolve(ROOT, argValue(args, "--registry", path.join(base, ".preprocess", "semantic_registry.json")));
  const out = path.resolve(ROOT, argValue(args, "--out", path.join(base, ".run_skill", "state_implementation", "state_implementation_model.llm.json")));
  const skillPath = path.resolve(__dirname, "..", "SKILL.md");
  const skill = readUtf8(skillPath);
  const blueprint = JSON.parse(readUtf8(blueprintPath));
  const registry = JSON.parse(readUtf8(registryPath));
  const skillInput = {
    viewport: {
      width,
      initial_height: height,
      width_locked: true,
      height_may_expand: true,
    },
    blueprint,
    semantic_registry: lightweightRegistry(registry),
    anchor_bboxes: anchorBboxes(registry),
    layout_constraints: layoutConstraints(),
  };

  writeUtf8(out.replace(/\.json$/, ".skill_input.json"), JSON.stringify(skillInput, null, 2));
  const raw = await callLLM({
    model,
    system: skill + "\n\nReturn JSON only.",
    user: JSON.stringify(skillInput),
    maxTokens: Number(argValue(args, "--max-tokens", "12000")),
  });
  writeUtf8(out.replace(/\.json$/, ".raw.txt"), raw);

  const parsed = normalizeModel(extractJson(raw));
  const issues = validateModel(parsed, registry);
  writeUtf8(out, JSON.stringify(parsed, null, 2));
  writeUtf8(out.replace(/\.json$/, ".validation.json"), JSON.stringify({ issues }, null, 2));
  if (issues.length) {
    console.error("[state-model-llm] validation issues:\n" + issues.join("\n"));
    process.exit(2);
  }
  console.log(`[state-model-llm] out=${out}`);
}

main().catch((err) => {
  console.error("[state-model-llm] ERROR:", err.stack || err.message);
  process.exit(1);
});
